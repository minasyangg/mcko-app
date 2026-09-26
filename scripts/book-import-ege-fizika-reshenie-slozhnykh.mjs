#!/usr/bin/env node
// Отдельный импортёр ТОЛЬКО для книги «Решение сложных задач. Материалы
// для ЕГЭ по физике» (ege100ballov) — не переиспользует scripts/book-import.mjs
// (см. book-import-ege-fizika-1000.mjs — та же логика решения по этой книге).
//
// Структура книги: 4 главы → 11 параграфов ("1.1. Кинематика" … "4.3. Физика
// атомного ядра"), внутри каждого параграфа СНАЧАЛА идут задачи с полным
// решением («Примеры решения задач и методические рекомендации»), ПОТОМ
// задачи с кратким ответом («Задачи для самостоятельного решения») — но
// нумерация «N.M.K.» (глава.параграф.номер) СКВОЗНАЯ через обе части
// параграфа, не рестартует на границе. Оглавление печатается в САМОМ КОНЦЕ
// книги (scan idx 348-349); печатная страница → scan index через постоянное
// смещение -14 (проверено по всем 21 параграфам — совпадает точно).
//
// Что делает:
//  1. Извлекает задачи по параграфам через composite-номер "N.M.K." (LIS
//     отфильтровывает случайные числа с точкой внутри самого текста задачи).
//  2. Текст задачи включает решение целиком (условие+решение слитно) — по
//     требованию пользователя теория (заголовки разделов, вводные абзацы
//     "Методика оценивания...") не грузится, только сами пронумерованные
//     задачи.
//  3. Короткий финальный ответ ("Ответ: 5 м/с." / "Omæem: ..." — OCR путает
//     «Ответ» с разными искажениями) вытаскивается в correct_answer, когда
//     он достаточно короткий (число/формула без развёрнутого текста) —
//     остальным задачам (с длинным текстовым ответом или без явного маркера)
//     эталонный ответ не ставится, весь текст остаётся в prompt_md.
//  4. Перезаливает картинки задач в Storage (bucket book-media).
//  5. Пишет книгу+разделы+страницы+задания в БД.
//
// Использование:
//   node scripts/book-import-ege-fizika-reshenie-slozhnykh.mjs <file.json> --dry-run
//   node scripts/book-import-ege-fizika-reshenie-slozhnykh.mjs <file.json>   # запись в БД
//
// Для записи в БД нужны env (или .env.import.local/.env.local):
//   SUPABASE_URL (или NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const args = process.argv.slice(2)
const file = args.find(a => !a.startsWith('--'))
if (!file) {
  console.error('Usage: node scripts/book-import-ege-fizika-reshenie-slozhnykh.mjs <file.json> [--dry-run]')
  process.exit(1)
}
const dryRun = args.includes('--dry-run')
const skipImages = args.includes('--skip-images')

const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
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

// ── Структура книги (проверено вручную по оглавлению, scan idx 348-349) ────
// pageStart каждого параграфа — заголовок "### N.M. НАЗВАНИЕ" подтверждён
// напрямую на этой странице для всех 11 параграфов. pageEnd — за 1 до
// pageStart следующего параграфа/главы (последний — до "Заключение", scan 348).
const CHAPTERS = [
  { title: '1. Механика', pageStart: 0 },
  { title: '2. Молекулярная физика и термодинамика', pageStart: 110 },
  { title: '3. Электродинамика', pageStart: 166 },
  { title: '4. Квантовая физика', pageStart: 316 },
]
const SECTIONS = [
  { chapter: 0, num: '1.1', title: '1.1. Кинематика', pageStart: 0 },
  { chapter: 0, num: '1.2', title: '1.2. Динамика', pageStart: 20 },
  { chapter: 0, num: '1.3', title: '1.3. Статика', pageStart: 40 },
  { chapter: 0, num: '1.4', title: '1.4. Законы сохранения в механике', pageStart: 57 },
  { chapter: 0, num: '1.5', title: '1.5. Механические колебания и волны', pageStart: 86 },
  { chapter: 1, num: '2.1', title: '2.1. Молекулярная физика', pageStart: 110 },
  { chapter: 1, num: '2.2', title: '2.2. Термодинамика', pageStart: 133 },
  { chapter: 2, num: '3.1', title: '3.1. Электрическое поле', pageStart: 166 },
  { chapter: 2, num: '3.2', title: '3.2. Законы постоянного тока', pageStart: 199 },
  { chapter: 2, num: '3.3', title: '3.3. Магнитное поле', pageStart: 229 },
  { chapter: 2, num: '3.4', title: '3.4. Электромагнитная индукция', pageStart: 246 },
  { chapter: 2, num: '3.5', title: '3.5. Электромагнитные колебания и волны', pageStart: 264 },
  { chapter: 2, num: '3.6', title: '3.6. Оптика', pageStart: 278 },
  { chapter: 3, num: '4.1', title: '4.1. Корпускулярно-волновой дуализм', pageStart: 316 },
  { chapter: 3, num: '4.2', title: '4.2. Физика атома', pageStart: 328 },
  { chapter: 3, num: '4.3', title: '4.3. Физика атомного ядра', pageStart: 339 },
]
const BOOK_END = 348 // «Заключение» / ОГЛАВЛЕНИЕ — не задачи
for (let i = 0; i < SECTIONS.length; i++) {
  const next = SECTIONS[i + 1]
  SECTIONS[i].pageEnd = (next ? next.pageStart : BOOK_END) - 1
}
for (let i = 0; i < CHAPTERS.length; i++) {
  const next = CHAPTERS[i + 1]
  CHAPTERS[i].pageEnd = (next ? next.pageStart : BOOK_END) - 1
}

// ── Извлечение заданий по параграфу (composite "N.M.K.") ───────────────────
// Номер главы.параграфа фиксирован для каждого §, извлекаем только третью
// компоненту K и проверяем совпадение первых двух с ожидаемыми — иначе
// формулы вида "2,5.3" внутри текста задачи дают ложные совпадения на
// СОСЕДНИЙ параграф и рвут LIS первого параграфа раньше времени.
function longestIncreasingByNum(items) {
  const tails = []
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

// Маркер сложности (звёздочка/степень трудности) печатается НАДСТРОЧНЫМ
// символом СРАЗУ ПОСЛЕ точки номера, перед пробелом — "1.1.7.⁸ Тело…",
// "1.1.18.³ За время…" — не перед точкой. OCR распознаёт надстрочный символ
// как что угодно (наблюдались ¹²³⁵⁶⁸°ºᶜ⁳⁲ по всей книге) — любой ОДИНОЧНЫЙ
// не-словесный/не-цифровой символ в этой позиции считается таким маркером
// (без строгого списка — иначе следующий OCR-вариант той же природы снова
// ломает LIS и создаёт разрыв в нумерации, как было с ⁸/²/³ до этого фикса).
function taskRe(sectionNum) {
  const [g, p] = sectionNum.split('.')
  return new RegExp(`^[ \\t]*(?:([oOоОοΟ0])[ \\t]{0,2})?${g}\\.${p}\\.(\\d{1,3})\\.[^\\sА-Яа-яA-Za-z0-9]?[ \\t]`, 'gm')
}

// «Ответ:»/«Omæem:»/«Omøem:» — OCR-варианты кириллического «Ответ:». OCR
// искажает слово множеством способов (Omæem, Omøem, Omeem, Omsem, Omseem,
// Otbet...) — общий признак: начинается на "Om"/"Ответ", заканчивается на
// "em"/"вет", перед ":". Ищем НЕ только в конце всего текста (как раньше),
// а с начала строки — маркер может стоять в середине решения, если после
// него есть комментарий/продолжение (редко, но встречается).
const ANSWER_MARKER_RE = /^[ \t]*(?:Ответ|Om[a-zа-яёæø]{0,5}em|Otbet)\s*:\s*([^\n]{1,200})\s*$/im

// «Примеры решения задач» в конце почти трети случаев дописывают методический
// комментарий-совет («При решении подобных задач следует...», «Обратите
// внимание...») — методика, не часть решения. Комментарий — всегда
// ПОСЛЕДНИЙ абзац и начинается с одной из типовых вводных фраз.
const METHOD_COMMENT_RE = /\n\n(?:При решении (?:подобных|этой|такого рода|данн\w+) задач[а-яё]*|Обратите внимание|Следует отметить|Обращаем внимание|Заметим, что|Читателю предлагается)[^\n]*(?:\n(?!\n)[^\n]*)*\s*$/i
function stripMethodComment(text) {
  return text.replace(METHOD_COMMENT_RE, '').trimEnd()
}

// «Решение.»/«Решение:» — всегда начинает отдельную строку (232/232 случая
// проверены руками), отделяет условие задачи от текста решения. Пользователь
// решил: ученику решение не показываем — prompt_md строится только из
// условия, решение используется исключительно для извлечения ответа.
const SOLUTION_HEAD_RE = /^Решени[ея][.:]/m

// Похоже на формулу/число (не развёрнутое текстовое рассуждение) — грубый
// фильтр перед тем, как ставить short-ответ в correct_answer с уверенным
// numeric_tolerance/normalized; длинные текстовые ответы всё равно ставятся,
// но с gradingMethod='manual' (см. ниже), т.к. учитель должен свериться сам.
function looksLikeShortAnswer(s) {
  return s.length <= 60 && !/[а-яё]{5,}/i.test(s.replace(/[a-zа-яё]{1,4}(?=[\s.,)]|$)/gi, ''))
}

// Ответа без явного маркера «Ответ:» — берём последнюю формулу/фразу решения
// (по решению пользователя: "бери последнюю формулу/фразу как ответ").
// Приоритет: последний display-math блок ($$...$$), иначе последнее
// предложение текста (после последней точки не в формуле).
function extractTrailingAnswer(solutionText) {
  const displayMatches = [...solutionText.matchAll(/\$\$([^$]+)\$\$/g)]
  if (displayMatches.length > 0) {
    const last = displayMatches[displayMatches.length - 1]
    // формула должна быть у самого конца текста (не в середине решения) —
    // после неё допускается только пунктуация/пробелы
    if (solutionText.slice(last.index + last[0].length).trim().length <= 2) {
      return { text: `$${last[1].trim()}$` }
    }
  }
  // последнее предложение (абзац) решения — грубое приближение ответа
  const paragraphs = solutionText.trim().split(/\n\n+/)
  const lastPara = paragraphs[paragraphs.length - 1]?.trim()
  if (!lastPara) return null
  const sentences = lastPara.split(/(?<=[.!?])\s+(?=[А-ЯЁ])/)
  const lastSentence = sentences[sentences.length - 1]?.trim()
  if (!lastSentence || lastSentence.length > 300) return null
  return { text: lastSentence }
}

function extractSectionProblems(section) {
  const candidates = []
  for (let idx = section.pageStart; idx <= section.pageEnd; idx++) {
    const p = pages[idx]
    if (!p) continue
    const re = taskRe(section.num)
    re.lastIndex = 0
    let m
    while ((m = re.exec(p.markdown)) !== null) {
      candidates.push({ num: parseInt(m[2]), pageIndex: idx, at: m.index })
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
    let fullText
    if (next && next.pageIndex !== cur.pageIndex) {
      // задача продолжается на следующих страницах до найденного следующего номера
      const parts = [p.markdown.slice(cur.at)]
      for (let pi = cur.pageIndex + 1; pi < next.pageIndex; pi++) parts.push(pages[pi]?.markdown ?? '')
      parts.push(pages[next.pageIndex].markdown.slice(0, next.at))
      fullText = parts.join('\n')
    } else {
      fullText = p.markdown.slice(cur.at, end)
    }
    fullText = stripDecorativeImages(fullText.trim())
      .replace(/^##### Задачи для самостоятельного решения\s*\n*/im, '') // подзаголовок мог влезть в начало атома
      .trim()

    // Условие/решение: «Решение.» начинает отдельную строку — всё после неё
    // не показываем ученику (prompt_md), только используем для ответа.
    const solHead = fullText.match(SOLUTION_HEAD_RE)
    const condition = (solHead ? fullText.slice(0, solHead.index) : fullText).trim()
    const solutionText = solHead ? fullText.slice(solHead.index) : ''
    const solutionClean = stripMethodComment(solutionText)

    let correctAnswer = null, gradingMethod = 'manual', answerIsApproximate = false
    // маркер «Ответ:» ищем И в условии (задачи «для самостоятельного
    // решения» обычно идут прямо condition + "Ответ:", без слова "Решение."
    // вовсе), И в решении (часть «Примеров» дают полное решение + явный
    // итоговый маркер в конце)
    const am = (solutionClean.match(ANSWER_MARKER_RE)) ?? (condition.match(ANSWER_MARKER_RE))
    if (am) {
      const ans = am[1].trim()
      correctAnswer = { text: ans }
      gradingMethod = looksLikeShortAnswer(ans) && /^-?[\d.,\s]+$/.test(ans) ? 'numeric_tolerance'
        : looksLikeShortAnswer(ans) ? 'normalized' : 'manual'
    } else if (solutionClean) {
      // решение есть, явного маркера нет — берём последнюю формулу/фразу.
      // Не гарантированно точный ответ (эвристика, не парсинг явного маркера) —
      // gradingMethod='manual' не даёт этому попасть в автопроверку, только
      // подсказка учителю; поле confident использовалось только для счётчика
      // выше и не идёт в БД (correct_answer хранит только {text}, как у
      // остальных книг — см. byTaskNumber/assignAnswer в других импортёрах).
      const trailing = extractTrailingAnswer(solutionClean)
      if (trailing) {
        correctAnswer = { text: trailing.text }
        gradingMethod = 'manual'
        answerIsApproximate = true
      }
    }

    // Условие без "Ответ:"-хвоста (если он там оказался, а решения не было)
    const prompt = condition.replace(ANSWER_MARKER_RE, '').trim()

    problems.push({
      taskNumber: `${section.num}.${cur.num}`,
      taskNumberSort: parseInt(section.num.split('.')[0]) * 10_000_000 + parseInt(section.num.split('.')[1]) * 100_000 + cur.num,
      pageIndex: cur.pageIndex,
      mdStart: cur.at,
      mdEnd: end,
      promptMd: prompt,
      hasImages: /<img\s/.test(prompt),
      sectionTitle: section.title,
      correctAnswer,
      answerSource: correctAnswer ? 'book_answers' : 'none',
      answerIsApproximate,
      gradingMethod,
    })
  }
  return problems
}

let allProblems = []
for (const s of SECTIONS) allProblems.push(...extractSectionProblems(s))

// ── Отчёт ────────────────────────────────────────────────────────────────────
console.log('════════ КНИГА ════════')
console.log('Решение сложных задач. Материалы для ЕГЭ по физике')
console.log('Физика, 10-11 класс, textbook, стр:', pages.length)
console.log('\n════════ СТАТИСТИКА ════════')
console.log('Заданий:', allProblems.length)
console.log('  с ответами из книги:', allProblems.filter(p => p.correctAnswer).length)
console.log('    из них по явному маркеру «Ответ:»:', allProblems.filter(p => p.correctAnswer && !p.answerIsApproximate).length)
console.log('    из них приближённо (последняя формула решения, без маркера):', allProblems.filter(p => p.answerIsApproximate).length)
console.log('  с картинками:', allProblems.filter(p => p.hasImages).length)
for (const s of SECTIONS) {
  const n = allProblems.filter(p => p.sectionTitle === s.title).length
  console.log(`  [${s.num}] ${s.title}: ${n} заданий (стр.${s.pageStart}-${s.pageEnd})`)
}

if (process.env.DEBUG_SAMPLE) {
  console.log('\n════════ ВЫБОРКА ОТВЕТОВ (проверка) ════════')
  const withAnswers = allProblems.filter(p => p.correctAnswer)
  for (const pr of [...withAnswers.slice(0, 8), ...withAnswers.slice(-8)]) {
    console.log(`${pr.taskNumber}: "${pr.promptMd.slice(0, 50).replace(/\n/g, ' ')}..." → ${JSON.stringify(pr.correctAnswer.text)}`)
  }
  console.log('\n════════ ПОЛНЫЙ ТЕКСТ 3 ЗАДАЧ (проверка условие/решение) ════════')
  for (const tn of ['1.1.1', '1.1.11', '1.4.32']) {
    const pr = allProblems.find(p => p.taskNumber === tn)
    if (!pr) { console.log(tn, ': НЕ НАЙДЕНА'); continue }
    console.log(`\n--- ${tn} ---`)
    console.log('prompt_md:', pr.promptMd)
    console.log('correctAnswer:', JSON.stringify(pr.correctAnswer))
  }
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
for (const c of CHAPTERS) c.id = randomUUID()
for (const s of SECTIONS) s.id = randomUUID()

const sectionRows = [
  ...CHAPTERS.map((c, i) => ({
    id: c.id, book_id: bookId, parent_id: null, kind: 'chapter', number: null,
    title: c.title, page_start: c.pageStart, page_end: c.pageEnd, sort_order: i, grade: 11,
  })),
  ...SECTIONS.map((s, i) => ({
    id: s.id, book_id: bookId, parent_id: CHAPTERS[s.chapter].id, kind: 'exercises', number: s.num,
    title: s.title, page_start: s.pageStart, page_end: s.pageEnd, sort_order: CHAPTERS.length + i, grade: 11,
  })),
]

const pageRows = pages.slice(0, BOOK_END).map(p => ({
  book_id: bookId,
  page_index: p.index,
  printed_page: p.index + 14,
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
    grading_method: pr.gradingMethod,
    correct_answer: pr.correctAnswer,
    answer_source: pr.answerSource,
    difficulty: 'standard',
    has_images: pr.hasImages,
    grade: 11,
  }
})

const bookRow = {
  id: bookId,
  book_type: 'textbook',
  title: 'Решение сложных задач. Материалы для ЕГЭ по физике',
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
    answers_matched: allProblems.filter(p => p.correctAnswer).length,
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
  for (const p of pages.slice(0, BOOK_END)) for (const u of Object.values(p.images)) uniqueUrls.add(u)

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
