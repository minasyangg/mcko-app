#!/usr/bin/env node
// Отдельный импортёр ТОЛЬКО для книги «1000 задач с ответами и решениями.
// Материалы для ЕГЭ по физике» (ege100ballov) — не переиспользует
// scripts/book-import.mjs, потому что структура книги специфична (нумерация
// заданий рестартует на границах 11 крупных разделов: «N.1. Задачи с
// кратким ответом» / «N.2. Задания с развёрнутым ответом» для N=1..5, плюс
// «6. Качественные задачи с развёрнутым ответом») — общий импортёр
// рассчитан на сквозную (plain/composite) нумерацию по всей книге, и
// адаптация его под этот частный случай была решено не делать (риск
// регресса на уже импортированных книгах не стоил разовой задачи).
//
// Что делает:
//  1. Восстанавливает исходный PaddleOCR JSON — он обрублен спереди
//     (отсутствует префикс первой страницы), см. фикс ниже.
//  2. Извлекает 811 заданий из 11 сегментов, каждый со своей нумерацией 1..N.
//  3. Сопоставляет краткие числовые ответы ТОЛЬКО из разделов «N.1. Задачи с
//     кратким ответом» (5 таких разделов) — по явному решению пользователя
//     развёрнутые решения («N.2», «6.») не грузятся как эталонный ответ.
//  4. Перезаливает картинки задач в Storage (bucket book-media).
//  5. Пишет книгу+разделы+страницы+задания в БД.
//
// Использование:
//   node scripts/book-import-ege-fizika-1000.mjs <file.json> --dry-run
//   node scripts/book-import-ege-fizika-1000.mjs <file.json>   # запись в БД
//
// Для записи в БД нужны env (или .env.import.local/.env.local):
//   SUPABASE_URL (или NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
const file = args.find(a => !a.startsWith('--'))
if (!file) {
  console.error('Usage: node scripts/book-import-ege-fizika-1000.mjs <file.json> [--dry-run]')
  process.exit(1)
}
const dryRun = args.includes('--dry-run')
const skipImages = args.includes('--skip-images')

// ── Восстановление обрубленного JSON ────────────────────────────────────────
// Файл начинается прямо с содержимого первого block_content вместо
// "[{"prunedResult":{"model_settings":{...},"parsing_res_list":[{"block_label":
// "paragraph_title","block_content":" — недостающий префикс восстанавливаем
// по идентичной структуре второго (целого) prunedResult того же файла.
const PREFIX = '[{"prunedResult":{"model_settings":{"use_doc_preprocessor":false,"use_layout_detection":true,"use_chart_recognition":true,"use_seal_recognition":true,"use_ocr_for_image_block":false,"format_block_content":true,"merge_layout_blocks":true,"markdown_ignore_labels":["number","footnote","header","header_image","footer","footer_image","aside_text"],"return_layout_polygon_points":true},"parsing_res_list":[{"block_label":"paragraph_title","block_content":'

let raw
{
  const buf = fs.readFileSync(file, 'utf-8')
  const fixed = buf.startsWith('["') ? PREFIX + buf.slice(1) : buf
  raw = JSON.parse(fixed)
}
if (!Array.isArray(raw)) { console.error('Ожидался массив страниц PaddleOCR'); process.exit(1) }

const pages = raw.map((p, idx) => ({
  index: idx,
  markdown: p.markdown?.text ?? '',
  images: p.markdown?.images ?? {},
}))

function rewriteImages(md, images) {
  let out = md
  for (const [key, url] of Object.entries(images)) out = out.replaceAll(`src="${key}"`, `src="${url}"`)
  return out
}
for (const p of pages) p.markdown = rewriteImages(p.markdown, p.images)

// Декоративные служебные метки-обрезки (см. project/AGENTS.md) — не встречены
// в этой книге при выборочной проверке, но фильтр держим на случай мелких
// артефактов OCR по краям страниц.
const DECORATIVE_IMG_MAX_PX = 70
function stripDecorativeImages(text) {
  return text.replace(
    /<div style="text-align: center;"><img src="([^"]*)" alt="Image" width="\d+%" \/><\/div>\n*/g,
    (whole, src) => {
      const m = src.match(/img_in_image_box_(\d+)_(\d+)_(\d+)_(\d+)/)
      if (!m) return whole
      const [x1, y1, x2, y2] = m.slice(1).map(Number)
      const w = x2 - x1, h = y2 - y1
      return (w < DECORATIVE_IMG_MAX_PX && h < DECORATIVE_IMG_MAX_PX) ? '' : whole
    }
  )
}

// ── 11 разделов книги (фиксированные границы, вручную сверены с TOC) ───────
// kind: 'short' — «Задачи с кратким ответом» (числовой ответ есть в разделе
// «Ответы»), 'long' — «Задания с развёрнутым ответом»/«Качественные задачи»
// (решения текстом — по решению пользователя эталонный ответ НЕ грузим).
const SECTIONS = [
  { title: '1. Механика',                              kind: 'chapter' },
  { title: '1.1. Задачи с кратким ответом',             kind: 'short', pageStart: 2,   pageEnd: 47 },
  { title: '1.2. Задания с развёрнутым ответом',        kind: 'long',  pageStart: 48,  pageEnd: 75 },
  { title: '2. Молекулярная физика и термодинамика',   kind: 'chapter' },
  { title: '2.1. Задачи с кратким ответом',             kind: 'short', pageStart: 76,  pageEnd: 94 },
  { title: '2.2. Задания с развёрнутым ответом',        kind: 'long',  pageStart: 95,  pageEnd: 113 },
  { title: '3. Электродинамика (Электричество)',       kind: 'chapter' },
  { title: '3.1. Задачи с кратким ответом',             kind: 'short', pageStart: 114, pageEnd: 127 },
  { title: '3.2. Задания с развёрнутым ответом',        kind: 'long',  pageStart: 128, pageEnd: 156 },
  { title: '4. Электродинамика (Электромагнитное поле)', kind: 'chapter' },
  { title: '4.1. Задачи с кратким ответом',             kind: 'short', pageStart: 157, pageEnd: 180 },
  { title: '4.2. Задания с развёрнутым ответом',        kind: 'long',  pageStart: 181, pageEnd: 202 },
  { title: '5. Квантовая физика',                      kind: 'chapter' },
  { title: '5.1. Задачи с кратким ответом',             kind: 'short', pageStart: 203, pageEnd: 213 },
  { title: '5.2. Задания с развёрнутым ответом',        kind: 'long',  pageStart: 214, pageEnd: 231 },
  { title: '6. Качественные задачи с развёрнутым ответом', kind: 'long', pageStart: 232, pageEnd: 263 },
]
// «N. Название главы» — родительские узлы только для структуры (page_start/
// page_end покрывают своих детей), не участвуют в извлечении заданий.
for (const s of SECTIONS) {
  if (s.kind === 'chapter') continue
}
// Восстанавливаем pageStart/pageEnd глав-родителей по их детям (первый и
// последний ребёнок в порядке SECTIONS до следующей главы)
for (let i = 0; i < SECTIONS.length; i++) {
  if (SECTIONS[i].kind !== 'chapter') continue
  let j = i + 1
  const starts = []
  while (j < SECTIONS.length && SECTIONS[j].kind !== 'chapter') { starts.push(SECTIONS[j]); j++ }
  SECTIONS[i].pageStart = starts[0]?.pageStart ?? null
  SECTIONS[i].pageEnd = starts[starts.length - 1]?.pageEnd ?? null
}

const ANSWERS_START = 264
const ANSWERS_END = 427
// Раздел «Ответы» зеркалит заголовки условий 1:1, но НЕ по линейному
// смещению страниц: некоторые разделы ответов сжаты (напр. «3.1» условий —
// 14 страниц, «3.1» ответов — 1 страница). Находим границу каждого раздела
// по заголовку "N.M. Название" внутри блока ответов, а не по константному
// сдвиге (тот давал грубо смещённые границы и ложные ответы у поздних
// разделов при проверке — см. DEBUG_SAMPLE).
const answersText = pages.slice(ANSWERS_START, ANSWERS_END + 1).map(p => p.markdown).join('\n')
function findAnswerRange(title) {
  const re = new RegExp(`^#{1,6}[ \\t]+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'm')
  const at = answersText.search(re)
  return at
}
// Границы ВСЕХ разделов (short+long+«6.»), чтобы конец каждого short-раздела
// определялся следующим заголовком любого типа, а не только следующим short
// (у этой книги short-раздел почти всегда следует за long того же N —
// «N.1» → «N.2» — и его конец находится ПОСЛЕДНИМ, если искать только среди
// short-заголовков дальше по документу).
const allLeafSections = SECTIONS.filter(s => s.kind !== 'chapter')
const allCuts = allLeafSections.map(s => ({ title: s.title, kind: s.kind, at: findAnswerRange(s.title) })).filter(c => c.at >= 0)
allCuts.sort((a, b) => a.at - b.at)
const answerCuts = allCuts.filter(c => c.kind === 'short')

// ── Извлечение заданий по сегменту ──────────────────────────────────────────
// Номер: "N." в начале строки либо после ";"/":" — допускаем перед номером
// необязательный кружок-маркер (○/o/0), как в общем импортёре.
const PLAIN_RE = /^[ \t]*(?:([oOоОοΟ0])[ \t]{0,2})?(\d{1,4})[*°]?\.(?:[ \t]|(?=[а-еa-z6ΓB]\)))/gm

function longestIncreasingByNum(items) {
  // items: [{num, idx}], возвращает подпоследовательность (по idx) строго
  // возрастающих num — классический O(n log n) LIS.
  const tails = [] // индексы items, концы возрастающих подпоследовательностей длины k+1
  const prev = new Array(items.length).fill(-1)
  for (let i = 0; i < items.length; i++) {
    const num = items[i].num
    let lo = 0, hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (items[tails[mid]].num < num) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = tails[lo - 1]
    if (lo === tails.length) tails.push(i)
    else tails[lo] = i
  }
  const out = []
  let k = tails.length > 0 ? tails[tails.length - 1] : -1
  while (k >= 0) { out.push(items[k]); k = prev[k] }
  return out.reverse()
}

function extractSegmentProblems(section, segNo) {
  const candidates = []
  for (let idx = section.pageStart; idx <= section.pageEnd; idx++) {
    const p = pages[idx]
    if (!p) continue
    PLAIN_RE.lastIndex = 0
    let m
    while ((m = PLAIN_RE.exec(p.markdown)) !== null) {
      candidates.push({ num: parseInt(m[2]), pageIndex: idx, at: m.index, glyph: m[1] ?? null })
    }
  }
  const kept = longestIncreasingByNum(candidates.map((c, i) => ({ num: c.num, idx: i })))
    .map(k => candidates[k.idx])

  const problems = []
  for (let i = 0; i < kept.length; i++) {
    const cur = kept[i]
    const next = kept[i + 1]
    const p = pages[cur.pageIndex]
    const end = next && next.pageIndex === cur.pageIndex ? next.at : p.markdown.length
    const prompt = stripDecorativeImages(p.markdown.slice(cur.at, end).trim())
    problems.push({
      taskNumber: `ч${segNo}.${cur.num}`,
      taskNumberSort: segNo * 100_000 + cur.num,
      pageIndex: cur.pageIndex,
      mdStart: cur.at,
      mdEnd: end,
      promptMd: prompt,
      hasImages: /<img\s/.test(prompt),
      sectionTitle: section.title,
      num: cur.num,
    })
  }
  return problems
}

let allProblems = []
let segNo = 0
for (const s of SECTIONS) {
  if (s.kind === 'chapter') continue
  segNo++
  s.segNo = segNo
  allProblems.push(...extractSegmentProblems(s, segNo))
}

// ── Ответы (только из «N.1. Задачи с кратким ответом») ──────────────────────
const byTaskNumber = new Map(allProblems.map(pr => [pr.taskNumber, pr]))
let answersFound = 0
function assignAnswer(taskNumber, rawAnswer) {
  const answer = rawAnswer.trim().replace(/\s+/g, ' ')
  const pr = byTaskNumber.get(taskNumber)
  if (!pr || pr.correctAnswer || !answer || answer.length > 300) return
  pr.correctAnswer = { text: answer }
  pr.answerSource = 'book_answers'
  pr.gradingMethod = /^-?\d[\d\s.,/]*\.?$/.test(answer) ? 'numeric_tolerance' : 'normalized'
  answersFound++
}

const ANSWER_NUM_RE = /(?<=^|[\s;])(\d{1,4})\.(?=\s|\d)/g
for (const cut of answerCuts) {
  const s = SECTIONS.find(x => x.title === cut.title)
  const nextAt = allCuts.find(c => c.at > cut.at)?.at ?? answersText.length
  const text = answersText.slice(cut.at, nextAt)
    .replace(/^#{1,6}\s.*$/gm, ' ') // заголовки разделов внутри диапазона — не ответы
  const rawPositions = []
  let am
  ANSWER_NUM_RE.lastIndex = 0
  while ((am = ANSWER_NUM_RE.exec(text)) !== null) {
    rawPositions.push({ num: parseInt(am[1]), at: am.index, contentAt: am.index + am[0].length })
  }
  const positions = longestIncreasingByNum(rawPositions.map((r, i) => ({ num: r.num, idx: i }))).map(k => rawPositions[k.idx])
  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i + 1].at : Math.min(text.length, positions[i].contentAt + 300)
    assignAnswer(`ч${s.segNo}.${positions[i].num}`, text.slice(positions[i].contentAt, end))
  }
}

// ── Отчёт ────────────────────────────────────────────────────────────────────
console.log('════════ КНИГА ════════')
console.log('1000 задач с ответами и решениями. Материалы для ЕГЭ по физике')
console.log('Физика, 10-11 класс, textbook, стр:', pages.length)
console.log('\n════════ СТАТИСТИКА ════════')
console.log('Заданий:', allProblems.length)
console.log('  с ответами из книги:', answersFound)
console.log('  с картинками:', allProblems.filter(p => p.hasImages).length)
for (const s of SECTIONS) {
  if (s.kind === 'chapter') continue
  const n = allProblems.filter(p => p.sectionTitle === s.title).length
  console.log(`  [ч${s.segNo}] ${s.title}: ${n} заданий (стр.${s.pageStart}-${s.pageEnd})`)
}

if (dryRun) process.exit(0)

// ── Запись в БД ──────────────────────────────────────────────────────────────

function loadEnv() {
  for (const f of ['.env.import.local', '.env.local', '.env.development.local']) {
    if (!fs.existsSync(f)) continue
    for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  }
}
loadEnv()
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('\nНет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env или .env.import.local).')
  process.exit(1)
}

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

const { createClient } = await import('@supabase/supabase-js')
const db = createClient(url, key)

const bookId = randomUUID()
for (const s of SECTIONS) s.id = randomUUID()

const sectionRows = SECTIONS.map((s, i) => ({
  id: s.id,
  book_id: bookId,
  parent_id: null,
  kind: s.kind === 'chapter' ? 'chapter' : 'exercises',
  number: null,
  title: s.title,
  page_start: s.pageStart,
  page_end: s.pageEnd,
  sort_order: i,
  grade: 11,
}))

const pageRows = pages.map(p => ({
  book_id: bookId,
  page_index: p.index,
  printed_page: null,
  markdown: p.markdown,
}))

const problemRows = allProblems.map(pr => {
  const section = SECTIONS.find(s => s.title === pr.sectionTitle)
  return {
    book_id: bookId,
    section_id: section?.id ?? null,
    task_number: pr.taskNumber,
    task_number_sort: pr.taskNumberSort,
    page_index: pr.pageIndex,
    md_start: pr.mdStart,
    md_end: pr.mdEnd,
    prompt_md: pr.promptMd,
    task_type: 'short_text',
    grading_method: pr.gradingMethod ?? 'manual',
    correct_answer: pr.correctAnswer ?? null,
    answer_source: pr.answerSource ?? 'none',
    difficulty: 'standard',
    has_images: pr.hasImages,
    grade: 11,
  }
})

const bookRow = {
  id: bookId,
  book_type: 'textbook',
  title: '1000 задач с ответами и решениями. Материалы для ЕГЭ по физике',
  authors: null,
  publisher: null,
  publication_year: null,
  subject: 'Физика',
  grade: 11,
  level: null,
  cover_image_path: null,
  page_count: pages.length,
  created_by: null,
  import_meta: {
    source_file: path.basename(file),
    problems: allProblems.length,
    answers_matched: answersFound,
    imported_at: new Date().toISOString(),
  },
}

const PAUSE_MS = 400
async function insertBatched(table, rows, batchSize) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const { error } = await withRetry(() => db.from(table).insert(rows.slice(i, i + batchSize)), `${table}@${i}`)
    if (error && error.code !== '23505') { console.error(`${table}@${i}:`, error.message); process.exit(1) }
    if (error) console.warn(`  ${table}@${i}: уже вставлено предыдущей попыткой (duplicate key), пропускаю`)
    await new Promise(r => setTimeout(r, PAUSE_MS))
  }
}

console.log('\nЗапись в БД...')
{
  const { error } = await withRetry(() => db.from('books').insert(bookRow), 'books')
  if (error) { console.error('books:', error.message); process.exit(1) }
}
await insertBatched('book_sections', sectionRows, 20)
await new Promise(r => setTimeout(r, 1000))
await insertBatched('book_pages', pageRows, 5)
await insertBatched('book_problems', problemRows, 20)
console.log(`Готово. book_id = ${bookId}`)

// ── Перезаливка картинок задач в Storage ────────────────────────────────────
if (!skipImages) {
  const urlToStorage = new Map()
  const uniqueUrls = new Set()
  for (const p of pages) for (const u of Object.values(p.images)) uniqueUrls.add(u)

  console.log(`\nПеренос картинок в Storage (${uniqueUrls.size} уникальных)...`)
  let uploaded = 0, failed = 0
  for (const externalUrl of uniqueUrls) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 12_000)
      let res
      try { res = await fetch(externalUrl, { signal: controller.signal }) } finally { clearTimeout(timer) }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await Promise.race([
        res.arrayBuffer(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('body read timeout')), 12_000)),
      ]))
      const pathPart = new URL(externalUrl).pathname
      const ext = (path.extname(pathPart) || '.jpg').toLowerCase()
      const contentType = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[ext] ?? 'image/jpeg'
      const filename = path.basename(pathPart).replace(/[^a-zA-Z0-9._-]/g, '_') || `img_${uploaded + failed}${ext}`
      const storagePath = `${bookId}/${filename}`
      const uploadPromise = db.storage.from('book-media').upload(storagePath, buf, { contentType, upsert: true })
      const { error: upErr } = await Promise.race([
        uploadPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Storage upload timeout')), 20_000)),
      ])
      if (upErr) throw new Error(upErr.message)
      const { data: pub } = db.storage.from('book-media').getPublicUrl(storagePath)
      urlToStorage.set(externalUrl, pub.publicUrl)
      uploaded++
    } catch (e) {
      console.warn(`  картинка не перезалита (${e.message}): ${externalUrl.slice(0, 100)}…`)
      failed++
    }
    if ((uploaded + failed) % 10 === 0) console.log(`  ...${uploaded + failed}/${uniqueUrls.size}`)
  }
  console.log(`Картинок перезалито: ${uploaded}, не удалось: ${failed}`)

  if (urlToStorage.size > 0) {
    console.log('Обновление ссылок в уже записанных страницах/заданиях...')
    for (const row of pageRows) {
      let md = row.markdown
      for (const [externalUrl, storageUrl] of urlToStorage) md = md.replaceAll(externalUrl, storageUrl)
      if (md !== row.markdown) {
        const { error } = await db.from('book_pages').update({ markdown: md }).eq('book_id', bookId).eq('page_index', row.page_index)
        if (error) console.error(`book_pages update@${row.page_index}:`, error.message)
      }
    }
    for (const row of problemRows) {
      let prompt = row.prompt_md
      for (const [externalUrl, storageUrl] of urlToStorage) prompt = prompt.replaceAll(externalUrl, storageUrl)
      if (prompt !== row.prompt_md) {
        const { error } = await db.from('book_problems').update({ prompt_md: prompt }).eq('book_id', bookId).eq('task_number', row.task_number)
        if (error) console.error(`book_problems update@${row.task_number}:`, error.message)
      }
    }
    console.log('Ссылки на картинки обновлены.')
  }
}

console.log(`\nВсё готово. book_id = ${bookId}`)
