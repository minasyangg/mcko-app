#!/usr/bin/env node
// Импортёр задач A-Level (формат Expert Tuition: "<Topic>.json" — условия +
// "<Topic>-MS.json" — mark scheme) в глобальную библиотеку library_problems.
//
// В отличие от book-import.mjs (завязан на русские учебники — "Глава"/"§",
// метки а)/б)/в), русские слова "Ответы") этот импортёр работает с
// англоязычным форматом Pearson Edexcel: вопросы пронумерованы "1.", "2." …,
// подпункты (a)/(b)/(i)/(ii), баллы — "(Total for Question N is M marks)".
// Mark scheme — HTML-таблицы (Question | Scheme | Marks | AOs), структура
// OCR неоднородна (разное число колонок, слипшиеся подпункты, обрезанные
// номера) — поэтому ответ сохраняется КАК ЕСТЬ, весь текст scheme-таблицы
// вопроса целиком, без попытки алгоритмически вычленить "короткий ответ".
// Проверка/упрощение ответа — на усмотрение учителя при простановке в ДЗ.
//
// Использование:
//   node scripts/alevel-import.mjs <Topic.json> <Topic-MS.json> --dry-run
//   node scripts/alevel-import.mjs <Topic.json> <Topic-MS.json> \
//     --exam-type "A-Level" --subject "Pure Mathematics 1" --topic "Exponentials & Logarithms"
//
// Без --dry-run пишет напрямую в library_problems/library_topics (нужны
// SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY в env
// или .env.import.local/.env.local).

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const positional = args.filter(a => !a.startsWith('--'))
const [qFile, msFile] = positional
if (!qFile || !msFile) {
  console.error('Usage: node scripts/alevel-import.mjs <Topic.json> <Topic-MS.json> [--dry-run] [--exam-type ...] [--subject ...] [--topic ...]')
  process.exit(1)
}
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const dryRun = args.includes('--dry-run')
const examType = flag('exam-type', 'A-Level')
const subject = flag('subject', 'Pure Mathematics 1')
const topicName = flag('topic', path.basename(qFile, '.json').replace(/-/g, ' '))

// ── Чтение исходных PaddleOCR JSON ──────────────────────────────────────────

function loadPages(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  if (!Array.isArray(raw)) throw new Error(`${file}: ожидался массив страниц`)
  return raw.map(p => p?.markdown?.text ?? '')
}

const qPages = loadPages(qFile)
const msPages = loadPages(msFile)
const qText = qPages.join('\n')
const msText = msPages.join('\n')

// ── Разбор файла условий ────────────────────────────────────────────────────
// Вопрос начинается с "N." в начале строки (N — 1-3 цифры). Исключаем
// совпадения внутри служебных строк вида "(Total for Question N is M marks)"
// и "Question N continued" — они не начинаются с цифры в начале строки, так
// что обычный якорь ^\d{1,3}\.\s уже их не матчит, но текст между вопросами
// может содержать эти строки — их надо вырезать из накопленного prompt.

const QUESTION_START_RE = /(?:^|\n)(\d{1,3})\.\s/g
// "(Total for Question N is M marks)" — надёжный якорь КОНЦА вопроса N, не
// зависит от того, распознал ли OCR номер в начале текста вопроса. Бывает
// (напр. вопрос 3 в Exponentials&Logarithms), что открывающий номер "N."
// вообще не попал в OCR — текст вопроса тогда молча приклеивается к
// предыдущему. Футер единственный надёжный сигнал такого случая.
const TOTAL_FOOTER_RE = /\(Total(?:\s+for\s+Question\s+(\d{1,3}))?\s+(?:is\s+)?\d+\s*marks?\)/gi

function stripNoise(text) {
  return text
    .replace(/<table[^>]*>[\s\S]*?<\/table>/gi, m => {
      // Таблицы в файле условий — почти всегда служебные
      // ("Question N continued", "(Total for Question N is M marks)").
      // Если внутри встречается "Total for Question" — вырезаем целиком,
      // иначе (редкий случай таблицы данных внутри вопроса) оставляем как есть.
      return /Total for Question|continued/i.test(m) ? '' : m
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseQuestions(text) {
  // markerStart — начало САМОГО маркера ("\nN. "), используется как граница
  // КОНЦА предыдущего вопроса (чтобы "N. " не просочился в чужой хвост).
  // bodyStart — начало текста вопроса (сразу после маркера), откуда
  // начинается срез ЭТОГО вопроса.
  const starts = [...text.matchAll(QUESTION_START_RE)].map(m => ({
    num: parseInt(m[1], 10),
    markerStart: m.index,
    bodyStart: m.index + m[0].length,
  }))
  const footers = [...text.matchAll(TOTAL_FOOTER_RE)]
    .map(m => ({ num: m[1] ? parseInt(m[1], 10) : null, at: m.index }))
    .filter(f => f.num != null)

  // Если открывающий номер "N." потерян OCR-ом (текст вопроса молча
  // приклеивается к предыдущему — бывает), но футер "Total for Question N-1"
  // ЕСТЬ в тексте — он и есть граница: всё после этого футера относится уже
  // к вопросу N, не к N-1. Добавляем такую границу только когда у нас есть
  // опорная точка (явный старт N-1) и нет явного старта N самого. У такой
  // синтетической границы markerStart === bodyStart (маркера-то нет).
  const haveNums = new Set(starts.map(s => s.num))
  for (const f of footers) {
    const nextNum = f.num + 1
    if (haveNums.has(nextNum)) continue // явный старт N+1 уже есть — ничего чинить не нужно
    if (!haveNums.has(f.num)) continue  // нет опорного вопроса N — пропускаем, не гадаем
    // Футер почти всегда живёт внутри <table>...</table> (нередко вместе
    // со строкой "Question N continued" в той же таблице, нескольких <tr>
    // одной table) — границу ставим ПОСЛЕ закрывающего </table>, а не сразу
    // после ")", иначе разрезаем таблицу пополам и бьём HTML в обеих
    // половинах (видно потом как мусорные обрывки тегов в prompt_text).
    // Если футер почему-то оказался вне таблицы — откатываемся на ")".
    const tableEnd = text.indexOf('</table>', f.at)
    const footerEnd = tableEnd !== -1 && tableEnd - f.at < 500
      ? tableEnd + '</table>'.length
      : text.indexOf(')', f.at) + 1
    starts.push({ num: nextNum, markerStart: footerEnd, bodyStart: footerEnd })
    haveNums.add(nextNum)
  }
  starts.sort((a, b) => a.bodyStart - b.bodyStart)

  const questions = new Map()
  for (let i = 0; i < starts.length; i++) {
    const { num, bodyStart } = starts[i]
    // Конец — начало МАРКЕРА следующего вопроса (не его bodyStart), иначе
    // "N. " следующего маркера просачивается в хвост текущего вопроса.
    const end = i + 1 < starts.length ? starts[i + 1].markerStart : text.length
    const body = stripNoise(text.slice(bodyStart, end))
    if (body) questions.set(num, `${num}. ${body}`)
  }
  return questions
}

const questions = parseQuestions(qText)

// ── Разбор mark scheme (HTML-таблицы) ───────────────────────────────────────
// Структура неоднородна (см. заголовок файла) — не пытаемся распарсить
// колонки/rowspan точно, вместо этого сканируем построчно (<tr>) и относим
// каждую строку к последнему встреченному номеру вопроса/подпункта в её
// первой ячейке. Один номер держится, пока не встретится следующий — так
// заметки/notes без номера корректно прилипают к предыдущему вопросу, а
// короткий вопрос без подпунктов (напр. "9"), оказавшийся последней строкой
// ТОЙ ЖЕ HTML-таблицы, что начата предыдущим вопросом (напр. "8(a)..."),
// не теряется.

function extractTables(text) {
  return [...text.matchAll(/<table[^>]*>[\s\S]*?<\/table>/gi)].map(m => m[0])
}

// Линеаризация одной строки <tr>...</tr> в текст: ячейки через " | ".
// Сохраняет весь контент (включая LaTeX $...$) без потери информации — этого
// достаточно, раз ответ хранится как scheme целиком, а не парсится на поля.
function rowToText(trHtml) {
  const cells = [...trHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m =>
    m[1].replace(/\s+/g, ' ').trim()
  ).filter(Boolean)
  if (cells.length === 0) return ''
  // Заголовок таблицы ("Question | Scheme | Marks | AOs") — не содержательная
  // строка, иначе она прилипает как "ответ" к вопросу, которым закончилась
  // предыдущая таблица.
  if (/^Question(\s+Number)?$/i.test(cells[0])) return ''
  return cells.join(' | ')
}

// Номер вопроса/подпункта — начало СТРОКИ (<tr>), не таблицы: одна HTML-
// таблица часто содержит несколько вопросов подряд (напр. короткий вопрос 9
// — последняя строка той же таблицы, что начата вопросом 8). Обычно номер в
// первой ячейке, но когда OCR не распознал границы колонок, вся строка
// (включая номер) схлопывается в ОДНУ ячейку — поэтому проверяем начало
// КАЖДОЙ ячейки строки, не только первой, а не весь текст целиком (чтобы не
// поймать номер вопроса, упомянутый где-то в середине scheme-текста).
// Строгий якорь: либо голый номер ("9"), либо номер сразу перед "(" без
// пробела или с ровно одним ("5(a)", "7 (a)", "80 (i)(a)", "75. (a) …") —
// отличает его от числа-ответа вроде "287 000 (must be rounded…)", где после
// цифр идёт пробел И ещё цифры, а не точка/буква/скобка.
function rowLeadingNumber(trInner) {
  const cells = [...trInner.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/\s+/g, ' ').trim())
  for (const t of cells) {
    if (!t || /^Question/i.test(t)) continue
    const m = t.match(/^(\d{1,3})\.?\s?\(/) || t.match(/^(\d{1,3})\.?$/)
    if (m) return parseInt(m[1], 10)
    break // номер ищем только в ПЕРВОЙ непустой ячейке строки
  }
  return null
}

const msTables = extractTables(msText)
const msByQuestion = new Map() // number -> text[] (строки scheme, в порядке документа)
let currentQ = null
for (const table of msTables) {
  const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map(m => m[0])
  for (const row of rows) {
    const num = rowLeadingNumber(row)
    if (num != null) currentQ = num
    if (currentQ == null) continue
    const line = rowToText(row)
    if (!line) continue
    const arr = msByQuestion.get(currentQ) ?? []
    arr.push(line)
    msByQuestion.set(currentQ, arr)
  }
}

// ── Сборка строк для вставки ────────────────────────────────────────────────

const rows = []
const missing = { noScheme: [], noQuestion: [] }

const allNums = new Set([...questions.keys(), ...msByQuestion.keys()])
for (const num of [...allNums].sort((a, b) => a - b)) {
  const prompt = questions.get(num)
  const scheme = msByQuestion.get(num)
  if (!prompt) { missing.noQuestion.push(num); continue }
  if (!scheme) { missing.noScheme.push(num); continue }
  rows.push({
    task_number: num,
    prompt_text: prompt,
    correct_answer: scheme.join('\n'),
  })
}

console.log(`Тема: ${topicName} (${examType} / ${subject})`)
console.log(`Вопросов в файле условий: ${questions.size}`)
console.log(`Групп scheme в MS-файле: ${msByQuestion.size}`)
console.log(`Сопоставлено пар (условие+ответ): ${rows.length}`)
if (missing.noScheme.length) console.warn(`Без scheme (пропущены): ${missing.noScheme.join(', ')}`)
if (missing.noQuestion.length) console.warn(`Без текста условия (пропущены): ${missing.noQuestion.join(', ')}`)

if (dryRun) {
  const outDir = path.join(path.dirname(qFile), 'preview')
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, `${path.basename(qFile, '.json')}.preview.json`)
  fs.writeFileSync(outFile, JSON.stringify(rows, null, 2), 'utf-8')
  console.log(`\n--dry-run: ничего не записано в БД. Черновик сохранён в ${outFile}`)
  process.exit(0)
}

// ── Запись в БД ──────────────────────────────────────────────────────────────

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
if (!url || !key) {
  console.error('\nНет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env или .env.import.local/.env.local). Либо используйте --dry-run.')
  process.exit(1)
}

const { createClient } = await import('@supabase/supabase-js')
const db = createClient(url, key)

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

console.log('\nЗапись в БД...')

// Тема: ищем существующую (exam_type, subject, fipicod=null, name=topicName),
// иначе создаём. fipicod не используется для A-Level (нет кодификатора ФИПИ),
// поэтому unique(exam_type, subject, fipicod) не защищает от дублей темы по
// имени — проверяем по name сами.
let topicId
{
  const { data: existing, error } = await db
    .from('library_topics')
    .select('id')
    .eq('exam_type', examType)
    .eq('subject', subject)
    .eq('name', topicName)
    .maybeSingle()
  if (error) { console.error('library_topics select:', error.message); process.exit(1) }
  if (existing) {
    topicId = existing.id
    console.log(`Тема уже существует: ${topicId}`)
  } else {
    // is_canonical=true — иначе тема не попадёт в дерево разделов на
    // странице библиотеки (app/teacher/library/page.tsx грузит только
    // канонические темы; для A-Level дублей-источников нет, поэтому каждая
    // новая тема сразу каноническая).
    const { data: created, error: insErr } = await db
      .from('library_topics')
      .insert({ exam_type: examType, subject, name: topicName, is_canonical: true })
      .select('id')
      .single()
    if (insErr) { console.error('library_topics insert:', insErr.message); process.exit(1) }
    topicId = created.id
    console.log(`Тема создана: ${topicId}`)
  }
}

const problemRows = rows.map(r => ({
  source_type: 'alevel-ocr',
  exam_type: examType,
  subject,
  topic_id: topicId,
  task_number_type: `Q${r.task_number}`,
  prompt_text: r.prompt_text,
  task_type: 'manual_review',
  grading_method: 'manual',
  correct_answer: JSON.stringify(r.correct_answer),
  organization_id: null, // глобальная библиотека
}))

const BATCH = 20
for (let i = 0; i < problemRows.length; i += BATCH) {
  const { error } = await withRetry(
    () => db.from('library_problems').insert(problemRows.slice(i, i + BATCH)),
    `library_problems@${i}`
  )
  if (error) { console.error(`library_problems@${i}:`, error.message); process.exit(1) }
  console.log(`  вставлено ${Math.min(i + BATCH, problemRows.length)}/${problemRows.length}`)
  await new Promise(r => setTimeout(r, 300))
}

console.log(`\nГотово. topic_id = ${topicId}, задач добавлено: ${problemRows.length}`)
