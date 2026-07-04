#!/usr/bin/env node
// Локальный импортёр книг из PaddleOCR JSON (PP-StructureV3) в модуль «Книги».
//
// Использование:
//   node scripts/book-import.mjs <file.json> --dry-run
//   node scripts/book-import.mjs <file.json> --emit-sql <dir>
//   node scripts/book-import.mjs <file.json>            # прямая запись в БД
//
// Мета книги (переопределяет эвристику):
//   --title "..." --authors "..." --subject Математика --grade 7
//   --level углублённый --type textbook --publisher "..." --year 2024
//
// Для прямой записи нужны env (или .env.import.local / .env.local):
//   SUPABASE_URL (или NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const file = args.find(a => !a.startsWith('--'))
if (!file) {
  console.error('Usage: node scripts/book-import.mjs <file.json> [--dry-run|--emit-sql <dir>] [--title ...]')
  process.exit(1)
}
function flag(name) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const dryRun = args.includes('--dry-run')
const emitSqlDir = args.includes('--emit-sql') ? (flag('emit-sql') ?? 'book-import-sql') : null

// ── Load pages ───────────────────────────────────────────────────────────────

const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
if (!Array.isArray(raw)) { console.error('Ожидался массив страниц PaddleOCR'); process.exit(1) }

const pages = raw.map((p, idx) => {
  const blocks = p.prunedResult?.parsing_res_list ?? []
  const numberBlock = blocks.find(b => b.block_label === 'number' && /^\d{1,4}$/.test(b.block_content?.trim() ?? ''))
  return {
    index: idx,
    printed: numberBlock ? parseInt(numberBlock.block_content.trim()) : null,
    markdown: p.markdown?.text ?? '',
    images: p.markdown?.images ?? {},
    titles: blocks.filter(b => b.block_label === 'paragraph_title').map(b => b.block_content),
    contentBlocks: blocks.filter(b => b.block_label === 'content').map(b => b.block_content),
  }
})

// ── Normalization ────────────────────────────────────────────────────────────

// OCR-артефакты подпунктов: латиница/цифры вместо кириллицы в маркерах "а) б) в) г) д) е)"
// Только в начале строки — безопасно (теория маркеры так же использует, замена эквивалентна).
const LETTER_MAP = { a: 'а', '6': 'б', b: 'б', B: 'в', c: 'в', d: 'г', r: 'г', 'Γ': 'г', D: 'д', e: 'е', f: 'е' }
function normalizeMarkers(md) {
  return md
    // " $ \Gamma $ " как маркер г)
    .replace(/^\s*\$\s*\\Gamma\s*\$\s*/gm, 'г) ')
    .replace(/^([a-zA-Z6Γ])\)\s/gm, (m, ch) => (LETTER_MAP[ch] ?? ch) + ') ')
}

function rewriteImages(md, images) {
  let out = md
  for (const [key, url] of Object.entries(images)) {
    out = out.replaceAll(`src="${key}"`, `src="${url}"`)
  }
  return out
}

for (const p of pages) {
  p.markdown = rewriteImages(normalizeMarkers(p.markdown), p.images)
}

// printed page → scan index
const printedToIndex = new Map()
for (const p of pages) {
  if (p.printed !== null && !printedToIndex.has(p.printed)) printedToIndex.set(p.printed, p.index)
}

// ── TOC (печатное оглавление из content-блоков) ──────────────────────────────

const tocText = pages.flatMap(p => p.contentBlocks).join('\n')
const warnings = []

function parseToc(text) {
  const sections = [] // {kind, number, title, printedPage, children: []}
  let chapter = null
  let paragraph = null
  let lastPage = null

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  let pending = '' // обрезанный переносом заголовок без номера страницы
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    // "Глава N" на отдельной строке — заголовок главы идёт следующей строкой
    const chapterMatch = line.match(/^(?:Глава|Плава|Гл\s*ава)\s*(\d+)?\s*$/i)
    if (chapterMatch) {
      pending = ''
      const titleLine = lines[i + 1] ?? ''
      const tm = titleLine.match(/^(.*?)\s*\.{2,}\s*(\d+|—)\s*$/)
      chapter = {
        kind: 'chapter', number: chapterMatch[1] ?? String(sections.filter(s => s.kind === 'chapter').length + 1),
        title: tm ? tm[1].trim() : titleLine.trim(),
        printedPage: tm && tm[2] !== '—' ? parseInt(tm[2]) : null,
        children: [],
      }
      if (chapter.printedPage) lastPage = chapter.printedPage
      sections.push(chapter)
      paragraph = null
      if (tm) i++ // заголовок главы поглощён
      continue
    }
    const m = line.match(/^(.*?)\s*\.{2,}\s*(\d+|—)\s*$/)
    if (!m) {
      // строка без ..... N — начало обрезанного переносом заголовка;
      // если следующая осмысленная строка содержит номер страницы и сама
      // не начинается с №/§/Глава — она продолжение этого заголовка
      pending = pending ? pending + ' ' + line : line
      continue
    }
    let title = m[1].trim()
    if (pending) {
      const startsNew = /^(§\s*\d|\d+\.\s|Глава)/i.test(title)
      if (!startsNew) title = (pending + ' ' + title).trim()
      pending = ''
    }
    const page = m[2] === '—' ? lastPage : parseInt(m[2])
    lastPage = page

    const para = title.match(/^§\s*(\d+)\.\s*(.+)$/)
    const punkt = title.match(/^(\d+)\.\s*(.+)$/)
    if (para) {
      paragraph = { kind: 'paragraph', number: `§ ${para[1]}`, title: para[2], printedPage: page, children: [] }
      ;(chapter?.children ?? sections).push(paragraph)
    } else if (punkt && paragraph) {
      paragraph.children.push({ kind: 'punkt', number: punkt[1], title: punkt[2], printedPage: page, children: [] })
    } else if (/^Дополнительные упражнения/i.test(title)) {
      ;(chapter?.children ?? sections).push({ kind: 'extra', number: null, title, printedPage: page, children: [] })
      paragraph = null
    } else {
      // Предисловие, Задачи повышенной трудности, Ответы, Предметный указатель...
      sections.push({ kind: 'other', number: null, title, printedPage: page, children: [] })
      chapter = null
      paragraph = null
    }
  }
  return sections
}

const toc = parseToc(tocText)
if (toc.length === 0) warnings.push('Оглавление не распарсилось — content-блоки не найдены или формат неизвестен')

// печатный номер → индекс скана; если конкретной страницы нет в карте
// (OCR не распознал номер), берём смещение от ближайшей известной
function printedToScan(printed) {
  if (printed === null || printed === undefined) return null
  if (printedToIndex.has(printed)) return printedToIndex.get(printed)
  for (let delta = 1; delta <= 10; delta++) {
    if (printedToIndex.has(printed - delta)) return printedToIndex.get(printed - delta) + delta
    if (printedToIndex.has(printed + delta)) return printedToIndex.get(printed + delta) - delta
  }
  return null
}

// page_start/page_end (индексы скана) по порядку обхода
const flatSections = []
;(function walk(nodes, parent) {
  for (const n of nodes) {
    n.parent = parent
    n.pageStart = printedToScan(n.printedPage)
    flatSections.push(n)
    walk(n.children, n)
  }
})(toc, null)

for (let i = 0; i < flatSections.length; i++) {
  const cur = flatSections[i]
  const next = flatSections.slice(i + 1).find(s => s.pageStart !== null && s.pageStart >= (cur.pageStart ?? 0))
  cur.pageEnd = next?.pageStart != null ? Math.max(cur.pageStart ?? 0, next.pageStart - (next.pageStart > (cur.pageStart ?? 0) ? 1 : 0)) : pages.length - 1
}

// ── Задания ──────────────────────────────────────────────────────────────────

// Диапазон страниц с ответами (исключаем из поиска заданий) + оглавление
const answersSection = flatSections.find(s => /^(ответы|otbet)/i.test(s.title))
const answersStart = answersSection?.pageStart ?? null
const indexSection = flatSections.find(s => /предметный указатель/i.test(s.title))
const answersEnd = indexSection?.pageStart != null ? indexSection.pageStart - 1 : pages.length - 1
const advancedSection = flatSections.find(s => /повышенной трудности/i.test(s.title))

const TASK_RE = /^(\d{1,4})\.[ \t]/gm
const problems = []
let lastNum = 0

for (const p of pages) {
  if (answersStart !== null && p.index >= answersStart) break // ответы и дальше — не задания
  if (p.contentBlocks.length > 0) continue // страницы оглавления

  const md = p.markdown
  const starts = []
  let m
  TASK_RE.lastIndex = 0
  while ((m = TASK_RE.exec(md)) !== null) {
    starts.push({ num: parseInt(m[1]), at: m.index })
  }
  for (let i = 0; i < starts.length; i++) {
    const { num, at } = starts[i]
    // сквозная нумерация: отбрасываем рестарты («Контрольные вопросы» нумеруются заново с 1)
    if (num <= lastNum - 5 || num > lastNum + 60) {
      warnings.push(`стр.${p.index}: пропущен номер ${num} (вне последовательности, последний ${lastNum})`)
      continue
    }
    const end = i + 1 < starts.length ? starts[i + 1].at : md.length
    let prompt = md.slice(at, end).trim()

    // перенос на следующую страницу: если следующая страница начинается не с задания/заголовка
    if (i === starts.length - 1 && p.index + 1 < pages.length) {
      const nextMd = pages[p.index + 1]?.markdown ?? ''
      TASK_RE.lastIndex = 0
      const nextTask = TASK_RE.exec(nextMd)
      const nextHeading = nextMd.search(/^#{1,6}\s/m)
      let cut = nextMd.length
      if (nextTask) cut = Math.min(cut, nextTask.index)
      if (nextHeading >= 0) cut = Math.min(cut, nextHeading)
      const cont = nextMd.slice(0, cut).trim()
      if (cont && cut > 0 && cut < 900 && !/^#/.test(cont)) {
        prompt += '\n\n' + cont
      }
    }

    lastNum = Math.max(lastNum, num)
    problems.push({
      taskNumber: String(num),
      taskNumberSort: num,
      pageIndex: p.index,
      mdStart: at,
      mdEnd: end,
      promptMd: prompt,
      hasImages: /<img\s/.test(prompt),
      difficulty:
        advancedSection && advancedSection.pageStart !== null &&
        p.index >= advancedSection.pageStart && p.index <= (advancedSection.pageEnd ?? -1)
          ? 'advanced' : 'standard',
    })
  }
}

// дубликаты номеров (unique constraint) — оставляем первое вхождение
const seen = new Set()
const uniqueProblems = []
for (const pr of problems) {
  if (seen.has(pr.taskNumber)) { warnings.push(`дубль номера ${pr.taskNumber} (стр.${pr.pageIndex}) — пропущен`); continue }
  seen.add(pr.taskNumber)
  uniqueProblems.push(pr)
}

// ── Привязка заданий к разделам ──────────────────────────────────────────────

const leafSections = flatSections.filter(s => s.children.length === 0 && s.pageStart !== null)
function sectionFor(pageIndex) {
  let best = null
  for (const s of leafSections) {
    if (pageIndex >= s.pageStart && pageIndex <= s.pageEnd) {
      if (!best || s.pageStart >= best.pageStart) best = s
    }
  }
  return best
}
for (const pr of uniqueProblems) {
  pr.section = sectionFor(pr.pageIndex)
  if (!pr.section) warnings.push(`задание ${pr.taskNumber} (стр.${pr.pageIndex}) не попало ни в один раздел`)
}

// ── Ответы ───────────────────────────────────────────────────────────────────

let answersFound = 0
if (answersStart !== null) {
  let text = pages.slice(answersStart, answersEnd + 1).map(p => p.markdown).join('\n')
  text = text
    .replace(/^#{1,6}\s.*$/gm, ' ')                 // заголовки (ОТВЕТЫ, Глава N)
    .replace(/К (параграфу|дополнительным упражнениям)[^.]*\./g, ' ')

  const positions = []
  const numRe = /(^|[\s;])(\d{1,4})\.\s/g
  let am
  while ((am = numRe.exec(text)) !== null) {
    positions.push({ num: parseInt(am[2]), at: am.index + am[1].length, contentAt: am.index + am[0].length })
  }
  const byNumber = new Map(uniqueProblems.map(pr => [pr.taskNumberSort, pr]))
  for (let i = 0; i < positions.length; i++) {
    const { num, contentAt } = positions[i]
    const end = i + 1 < positions.length ? positions[i + 1].at : Math.min(text.length, contentAt + 600)
    const answer = text.slice(contentAt, end).trim().replace(/\s+/g, ' ')
    const pr = byNumber.get(num)
    if (!pr || pr.correctAnswer || !answer || answer.length > 600) continue
    pr.correctAnswer = { text: answer }
    pr.answerSource = 'book_answers'
    // простой короткий ответ без подпунктов → автопроверка
    if (!/[абвгде]\)/.test(answer) && answer.length <= 24) {
      pr.gradingMethod = /^-?\d[\d\s.,/]*\.?$/.test(answer) ? 'numeric_tolerance' : 'normalized'
    } else {
      pr.gradingMethod = 'manual'
    }
    answersFound++
  }
}

// ── Мета ─────────────────────────────────────────────────────────────────────

const meta = {
  title: flag('title') ?? path.basename(file, '.json'),
  authors: flag('authors') ?? null,
  subject: flag('subject') ?? 'Математика',
  grade: flag('grade') ?? null,
  level: flag('level') ?? null,
  bookType: flag('type') ?? 'textbook',
  publisher: flag('publisher') ?? null,
  year: flag('year') ? parseInt(flag('year')) : null,
  coverImage: raw[0]?.inputImage ?? null,
  pageCount: pages.length,
}

// ── Отчёт ────────────────────────────────────────────────────────────────────

console.log('════════ КНИГА ════════')
console.log(`${meta.title}${meta.authors ? ' — ' + meta.authors : ''}`)
console.log(`${meta.subject}, класс ${meta.grade ?? '?'}, ${meta.level ?? ''} [${meta.bookType}], стр: ${meta.pageCount}`)
console.log()
console.log('════════ СОДЕРЖАНИЕ ════════')
;(function print(nodes, depth) {
  for (const n of nodes) {
    console.log(`${'  '.repeat(depth)}${n.number ? n.number + '. ' : ''}${n.title}  [скан ${n.pageStart ?? '?'}–${n.pageEnd ?? '?'}]`)
    print(n.children, depth + 1)
  }
})(toc, 0)
console.log()
console.log('════════ СТАТИСТИКА ════════')
console.log(`Заданий: ${uniqueProblems.length} (макс. номер: ${lastNum})`)
console.log(`  с ответами из книги: ${answersFound}`)
console.log(`  с автопроверкой:     ${uniqueProblems.filter(p => p.gradingMethod && p.gradingMethod !== 'manual').length}`)
console.log(`  с картинками:        ${uniqueProblems.filter(p => p.hasImages).length}`)
console.log(`  повышенной трудности: ${uniqueProblems.filter(p => p.difficulty === 'advanced').length}`)
console.log(`  без раздела:         ${uniqueProblems.filter(p => !p.section).length}`)
console.log(`Предупреждений: ${warnings.length}`)
for (const w of warnings.slice(0, 25)) console.log(`  ⚠ ${w}`)
if (warnings.length > 25) console.log(`  ... и ещё ${warnings.length - 25}`)

if (dryRun) process.exit(0)

// ── Генерация строк ──────────────────────────────────────────────────────────

const bookId = randomUUID()
for (const s of flatSections) s.id = randomUUID()

const sectionRows = flatSections.map((s, i) => ({
  id: s.id,
  book_id: bookId,
  parent_id: s.parent?.id ?? null,
  kind: s.kind,
  number: s.number,
  title: s.title,
  page_start: s.pageStart,
  page_end: s.pageEnd,
  sort_order: i,
}))

const pageRows = pages.map(p => ({
  book_id: bookId,
  page_index: p.index,
  printed_page: p.printed,
  markdown: p.markdown,
}))

const problemRows = uniqueProblems.map(pr => ({
  book_id: bookId,
  section_id: pr.section?.id ?? null,
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
  difficulty: pr.difficulty,
  has_images: pr.hasImages,
}))

const bookRow = {
  id: bookId,
  book_type: meta.bookType,
  title: meta.title,
  authors: meta.authors,
  publisher: meta.publisher,
  publication_year: meta.year,
  subject: meta.subject,
  grade: meta.grade,
  level: meta.level,
  cover_image_path: meta.coverImage,
  page_count: meta.pageCount,
  import_meta: {
    source_file: path.basename(file),
    problems: uniqueProblems.length,
    answers_matched: answersFound,
    warnings: warnings.slice(0, 100),
    imported_at: new Date().toISOString(),
  },
}

// ── Режим --emit-sql ─────────────────────────────────────────────────────────

if (emitSqlDir) {
  fs.mkdirSync(emitSqlDir, { recursive: true })
  const q = v => {
    if (v === null || v === undefined) return 'null'
    if (typeof v === 'number') return String(v)
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    if (typeof v === 'object') return `${q(JSON.stringify(v))}::jsonb`
    return `$mk$${String(v).replaceAll('$mk$', '')}$mk$`
  }
  const insert = (table, rows) => {
    if (rows.length === 0) return ''
    const cols = Object.keys(rows[0])
    const values = rows.map(r => `(${cols.map(c => q(r[c])).join(',')})`).join(',\n')
    return `insert into ${table} (${cols.join(',')}) values\n${values};\n`
  }
  let n = 0
  const write = (name, sql) => fs.writeFileSync(path.join(emitSqlDir, `${String(n++).padStart(3, '0')}_${name}.sql`), sql)

  write('book', insert('books', [bookRow]))
  write('sections', insert('book_sections', sectionRows))
  const PAGES_PER = 30
  for (let i = 0; i < pageRows.length; i += PAGES_PER) {
    write(`pages_${i}`, insert('book_pages', pageRows.slice(i, i + PAGES_PER)))
  }
  const PROBS_PER = 90
  for (let i = 0; i < problemRows.length; i += PROBS_PER) {
    write(`problems_${i}`, insert('book_problems', problemRows.slice(i, i + PROBS_PER)))
  }
  console.log(`\nSQL записан в ${emitSqlDir}/ (${n} файлов). book_id = ${bookId}`)
  process.exit(0)
}

// ── Прямая запись в БД ───────────────────────────────────────────────────────

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
  console.error('\nНет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env или .env.import.local). Либо используйте --emit-sql.')
  process.exit(1)
}

const { createClient } = await import('@supabase/supabase-js')
const db = createClient(url, key)

console.log('\nЗапись в БД...')
{
  const { error } = await db.from('books').insert(bookRow)
  if (error) { console.error('books:', error.message); process.exit(1) }
}
{
  const { error } = await db.from('book_sections').insert(sectionRows)
  if (error) { console.error('book_sections:', error.message); process.exit(1) }
}
for (let i = 0; i < pageRows.length; i += 100) {
  const { error } = await db.from('book_pages').insert(pageRows.slice(i, i + 100))
  if (error) { console.error(`book_pages@${i}:`, error.message); process.exit(1) }
}
for (let i = 0; i < problemRows.length; i += 200) {
  const { error } = await db.from('book_problems').insert(problemRows.slice(i, i + 200))
  if (error) { console.error(`book_problems@${i}:`, error.message); process.exit(1) }
}
console.log(`Готово. book_id = ${bookId}`)
