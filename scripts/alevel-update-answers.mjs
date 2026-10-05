#!/usr/bin/env node
// Разовый апдейтер: переписывает correct_answer уже вставленных A-Level
// задач в markdown-таблицу (было: plain-текст через ' | ') — догоняет
// библиотеку после того, как alevel-import.mjs стал генерировать новый
// формат. Сопоставляет по topic_id + task_number_type ("Q1", "Q10"...).
//
// Использование:
//   node scripts/alevel-update-answers.mjs <preview.json> --topic-id <uuid> [--dry-run]

import fs from 'node:fs'

const args = process.argv.slice(2)
const previewFile = args.find(a => !a.startsWith('--'))
if (!previewFile) {
  console.error('Usage: node scripts/alevel-update-answers.mjs <preview.json> --topic-id <uuid> [--dry-run]')
  process.exit(1)
}
function flag(name) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const topicId = flag('topic-id')
if (!topicId) { console.error('Нужен --topic-id <uuid>'); process.exit(1) }
const dryRun = args.includes('--dry-run')

const rows = JSON.parse(fs.readFileSync(previewFile, 'utf-8'))

function loadEnv() {
  for (const f of ['.env.import.local', '.env.local']) {
    if (fs.existsSync(f)) {
      for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
        const m = line.match(/^([A-Z_]+)=(.*)$/)
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
      }
    }
  }
}
loadEnv()
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

const { createClient } = await import('@supabase/supabase-js')
const db = createClient(url, key)

const { data: existing, error } = await db
  .from('library_problems')
  .select('id, task_number_type')
  .eq('topic_id', topicId)
if (error) { console.error('select:', error.message); process.exit(1) }

const idByTaskNum = new Map(existing.map(r => [r.task_number_type, r.id]))

// Сетевые запросы на этой машине иногда рвутся транзиентно (TLS-
// перехватывающий прокси) — ретраим по аналогии с alevel-import.mjs, иначе
// один "fetch failed" посреди 79 обновлений молча останавливает весь прогон
// (как уже случилось на Q6 в первом запуске без ретраев).
async function withRetry(fn, label, attempts = 5) {
  let result
  for (let i = 1; i <= attempts; i++) {
    try { result = await fn() } catch (e) { result = { error: e } }
    if (!result?.error) return result
    if (i === attempts) return result
    console.warn(`  ${label}: попытка ${i} не удалась (${result.error.message}), повтор через ${i}с...`)
    await new Promise(r => setTimeout(r, i * 1000))
  }
  return result
}

let updated = 0, skipped = 0, failed = 0
for (const row of rows) {
  const key = `Q${row.task_number}`
  const id = idByTaskNum.get(key)
  if (!id) { skipped++; continue }
  if (dryRun) { updated++; continue }
  // correct_answer — jsonb-колонка со строковым значением (markdown-
  // таблица). supabase-js сам сериализует JS-строку в jsonb корректно —
  // ручной JSON.stringify() здесь удваивал экранирование (кавычки и "\n"
  // как текст вместо настоящих переносов строк), что и привело к тому, что
  // первый прогон записал в БД строку-в-строке вместо самой таблицы.
  const { error: updErr } = await withRetry(
    () => db.from('library_problems').update({ correct_answer: row.correct_answer }).eq('id', id),
    `update ${key}`
  )
  if (updErr) { console.error(`update ${key} (${id}) — все попытки неудачны:`, updErr.message); failed++; continue }
  updated++
  await new Promise(r => setTimeout(r, 150))
}
if (failed) console.error(`Не удалось обновить: ${failed}`)

console.log(`${dryRun ? '[dry-run] ' : ''}Обновлено: ${updated}, пропущено (нет в БД): ${skipped}`)
