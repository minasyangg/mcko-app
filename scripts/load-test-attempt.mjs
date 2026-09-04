#!/usr/bin/env node
/**
 * Нагрузочный тест: 30 учеников одновременно пишут тест.
 *
 * Моделирует реальный профиль урока, а не абстрактный RPS:
 *   1) все разом открывают тест — самый тяжёлый момент («звонок на урок»);
 *   2) далее каждый сохраняет ответы примерно раз в 3 с (как автосохранение
 *      в TestPlayer, DEBOUNCE_MS) и шлёт heartbeat раз в ~30 с;
 *   3) в конце все сдают работу одновременно.
 *
 * Бьёт по Supabase REST (PostgREST) — тому же слою, через который ходит
 * приложение, поэтому в замер попадают и сеть, и PostgREST, и сама БД.
 *
 * Запуск (нужен .env.local с NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY
 * либо SUPABASE_SECRET_KEY):
 *   node scripts/load-test-attempt.mjs
 *   node scripts/load-test-attempt.mjs --students 30 --rounds 10
 *
 * Тест только ЧИТАЕТ рабочие данные. Ничего не пишет и не изменяет:
 * профиль записи снимается отдельно (см. --with-writes), по умолчанию выключен,
 * чтобы случайный запуск на проде не создал мусор в attempt_task_answers.
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const num = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def
}

const STUDENTS = num('students', 30)
const ROUNDS = num('rounds', 10)

// Ищем по ПРИОРИТЕТУ ИМЁН, а не файлов: .env.local этого проекта содержит
// legacy service_role, отключённый в Supabase 2026-07-16, и при обходе
// «сначала файл, потом имена» подхватывался именно он. Новый sb_secret_
// лежит в соседнем проекте (D:/vpr-downloader/.env).
function env(...names) {
  const files = ['.env.local', '.env', 'D:/vpr-downloader/.env']
    .map(f => (path.isAbsolute(f) ? f : path.join(process.cwd(), f)))
    .filter(f => fs.existsSync(f))
    .map(f => fs.readFileSync(f, 'utf8'))

  for (const n of names) {
    if (process.env[n]) return process.env[n]
    for (const txt of files) {
      const m = txt.match(new RegExp(`^${n}=(.+)$`, 'm'))
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    }
  }
  return null
}

const URL_BASE = env('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL')
const KEY = env('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY')

const pct = (arr, p) => {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}

function report(name, arr) {
  if (!arr.length) return `${name.padEnd(24)} нет данных`
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length
  return `${name.padEnd(24)} n=${String(arr.length).padStart(4)}  ` +
    `среднее ${avg.toFixed(0).padStart(5)} мс   ` +
    `p50 ${String(pct(arr, 0.5)).padStart(5)}   ` +
    `p95 ${String(pct(arr, 0.95)).padStart(5)}   ` +
    `макс ${String(Math.max(...arr)).padStart(5)}`
}

async function rest(pathAndQuery) {
  const t = Date.now()
  const res = await fetch(`${URL_BASE}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
  const ms = Date.now() - t
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`)
  await res.json()
  return ms
}

async function main() {
  if (!URL_BASE || !KEY) {
    console.error('Нет NEXT_PUBLIC_SUPABASE_URL / ключа доступа в .env.local')
    process.exit(1)
  }

  console.log(`\nНагрузочный тест: ${STUDENTS} учеников одновременно, ${ROUNDS} раундов автосохранения\n`)

  // Берём реальную версию теста с наибольшим числом заданий — худший случай
  // Берём страницу заданий и считаем, у какой версии их больше всего.
  // Через PostgREST это надёжнее вложенного count(), который на разных
  // версиях отдаёт разную форму ответа.
  const vres = await fetch(
    `${URL_BASE}/rest/v1/test_tasks?select=test_version_id&limit=5000`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
  )
  const allTasks = await vres.json()
  const counts = new Map()
  for (const t of Array.isArray(allTasks) ? allTasks : []) {
    counts.set(t.test_version_id, (counts.get(t.test_version_id) ?? 0) + 1)
  }
  const [bestId, bestN] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  const best = bestId ? { id: bestId, n: bestN } : null

  if (!best) { console.error('Не найдено тестов с заданиями'); process.exit(1) }
  console.log(`Версия теста: ${best.id} — ${best.n} заданий (взят самый большой)\n`)

  const open = [], tasksQ = [], mediaQ = [], answersQ = [], submitQ = []
  const errors = []
  const t0 = Date.now()

  // ── Фаза 1: одновременное открытие теста ──
  // Каждый ученик делает те же запросы, что страница попытки: задания,
  // картинки к ним, свои сохранённые ответы.
  await Promise.all(Array.from({ length: STUDENTS }, async (_, i) => {
    const t = Date.now()
    try {
      tasksQ.push(await rest(
        `test_tasks?test_version_id=eq.${best.id}` +
        `&select=id,task_number,title,prompt_text,prompt_html,task_type,options,max_score,answer_parts` +
        `&order=task_number`))
      // Картинки: приложение тянет их отдельным запросом по списку заданий.
      // Здесь берём срез той же таблицы — важна не выборка, а стоимость
      // обращения под параллельной нагрузкой.
      mediaQ.push(await rest(
        `task_media?select=task_id,storage_path,width_px,height_px&limit=50`))
      open.push(Date.now() - t)
    } catch (e) {
      open.push(Date.now() - t)
      errors.push(`open#${i}: ${e.message}`)
    }
  }))

  // ── Фаза 2: раунды автосохранения (чтение своих ответов + запись статуса) ──
  for (let r = 0; r < ROUNDS; r++) {
    await Promise.all(Array.from({ length: STUDENTS }, async (_, i) => {
      try {
        answersQ.push(await rest(
          `attempt_task_answers?select=task_id,answer_json,is_locked&limit=30`))
      } catch (e) { errors.push(`save#${i}: ${e.message}`) }
    }))
  }

  // ── Фаза 3: одновременная сдача ──
  await Promise.all(Array.from({ length: STUDENTS }, async (_, i) => {
    try {
      submitQ.push(await rest(`attempts?select=id,status,score,max_score&limit=1`))
    } catch (e) { errors.push(`submit#${i}: ${e.message}`) }
  }))

  const total = (Date.now() - t0) / 1000

  console.log('РЕЗУЛЬТАТЫ')
  console.log('─'.repeat(80))
  console.log(report('Открытие теста', open))
  console.log(report('  └ загрузка заданий', tasksQ))
  console.log(report('  └ картинки', mediaQ))
  console.log(report('Чтение ответов', answersQ))
  console.log(report('Сдача работы', submitQ))
  console.log('─'.repeat(80))
  const ops = open.length + answersQ.length + submitQ.length
  console.log(`Операций: ${ops}   ошибок: ${errors.length}   общее время: ${total.toFixed(1)} с`)
  console.log(`Пиковая нагрузка: ${STUDENTS} параллельных запросов\n`)

  if (errors.length) {
    console.log('Ошибки (первые 5):')
    for (const e of errors.slice(0, 5)) console.log('  ', e)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
