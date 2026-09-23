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
// Учебник на НЕСКОЛЬКО классов сразу (одна книга, главы делятся по классам
// внутри — напр. Атанасян «Геометрия. 7-9 классы»): --grade оставляем
// пустым/не задаём, а границы задаём явно per-книга —
//   --grade-by-chapter "7:1-5,8:6-9,9:10-15"
//   --grade-by-paragraph "7:1-28,8:29-50,9:51-65"   # для книг без "Глава N"
//                                                     # вовсе, где границы
//                                                     # только по номеру §
// (номер главы/параграфа = порядковый счётчик по документу, 1-based;
// диапазоны включительно). grade проставляется на book_sections/
// book_problems, не на books — см. миграцию 078.
//
// РАЗДЕЛИТЬ такую книгу на N отдельных записей books (не просто пометить
// grade внутри одной) — --only-grade вместе с --grade-by-chapter/
// --grade-by-paragraph, запускать N раз с разным --only-grade/--title:
//   node scripts/book-import.mjs sbornik.json --grade-by-paragraph "7:1-28,8:29-50,9:51-65" --only-grade 7 --title "…7 класс"
//   node scripts/book-import.mjs sbornik.json --grade-by-paragraph "7:1-28,8:29-50,9:51-65" --only-grade 8 --title "…8 класс"
//   node scripts/book-import.mjs sbornik.json --grade-by-paragraph "7:1-28,8:29-50,9:51-65" --only-grade 9 --title "…9 класс"
//
// Исходный PDF книги (опционально, только для прямой записи в БД):
//   --pdf <file.pdf>        # сжимается через scripts/compress-pdf.mjs и заливается
//                           # в приватный bucket book-documents, путь пишется в
//                           # books.pdf_storage_path — см. project_books_module
//   --pdf-no-compress       # залить как есть, без прогона через Ghostscript
//
// Картинки задач (только для прямой записи в БД, идёт ПОСЛЕ вставки заданий,
// не блокирует их доступность — см. project_books_module):
//   --skip-images            # не перезаливать картинки в book-media вовсе
//                             # (оставить исходные bcebos-ссылки — они истекают)
//   --images-concurrency N   # параллельных загрузок, по умолчанию 1
//                             # (на машинах с TLS-перехватывающим прокси несколько
//                             # параллельных HTTPS-соединений к одному внешнему
//                             # хосту замечены зависающими навечно)
//
// Для прямой записи нужны env (или .env.import.local / .env.local):
//   SUPABASE_URL (или NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

// "7:1-5,8:6-9,9:10-15" → [{grade:'7', from:1, to:5}, ...] — номер главы
// = порядковый счётчик "Глава N" по документу (1-based), не печатное
// римское/арабское число (см. parseToc: fallback-нумерация чинит это само).
function parseGradeByChapter(spec) {
  if (!spec) return null
  return spec.split(',').map(part => {
    const m = part.trim().match(/^(\d+)\s*:\s*(\d+)\s*-\s*(\d+)$/)
    if (!m) { console.error(`--grade-by-chapter: не разобрано "${part}", ожидался формат "7:1-5"`); process.exit(1) }
    return { grade: m[1], from: parseInt(m[2]), to: parseInt(m[3]) }
  })
}
const gradeByChapter = parseGradeByChapter(flag('grade-by-chapter'))
// То же самое, но по номеру §-параграфа, а не главы — для книг без
// обёртки "Глава N" (сборники, где все параграфы 1..65 идут плоским
// root-level списком, напр. Перышкин «Сборник задач по физике. 7-9 кл»).
function parseGradeByParagraph(spec) {
  if (!spec) return null
  return spec.split(',').map(part => {
    const m = part.trim().match(/^(\d+)\s*:\s*(\d+)\s*-\s*(\d+)$/)
    if (!m) { console.error(`--grade-by-paragraph: не разобрано "${part}", ожидался формат "7:1-28"`); process.exit(1) }
    return { grade: m[1], from: parseInt(m[2]), to: parseInt(m[3]) }
  })
}
const gradeByParagraph = parseGradeByParagraph(flag('grade-by-paragraph'))
// Книга на несколько классов, которую нужно РАЗДЕЛИТЬ на отдельные книги в
// БД (не просто расставить grade внутри одной) — используется вместе с
// --grade-by-chapter/--grade-by-paragraph: тот расставляет grade каждой
// секции, этот фильтрует итоговые задания только этим классом, остальные
// в эту книгу не попадают вовсе. Запускать импорт нужно N раз (по разу на
// класс) с одним и тем же --grade-by-paragraph, но разным --only-grade и
// --title/--grade — так книга физически разделится на N записей books.
const onlyGrade = flag('only-grade') ?? null
if (onlyGrade && !gradeByChapter && !gradeByParagraph) {
  console.error('--only-grade требует --grade-by-chapter или --grade-by-paragraph (иначе grade у секций не проставлен и книга выйдет пустой)')
  process.exit(1)
}
const pdfFile = flag('pdf') ?? null
const pdfNoCompress = args.includes('--pdf-no-compress')
if (pdfFile && !fs.existsSync(pdfFile)) {
  console.error(`--pdf: файл не найден: ${pdfFile}`)
  process.exit(1)
}
if (pdfFile && emitSqlDir) {
  console.error('--pdf несовместим с --emit-sql: заливка бинарного файла в Storage возможна только при прямой записи в БД.')
  process.exit(1)
}

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
    // PaddleOCR иногда рендерит заголовок тематического подраздела/варианта/
    // работы как служебный "header" (колонтитул) вместо "paragraph_title" —
    // такой блок не попадает в markdown страницы вовсе. Сохраняем координату
    // (y0 bbox) на будущее, а также позицию каждого "text"-блока (для вставки
    // header'а в markdown перед правильным по счёту параграфом — см.
    // insertHeaderBlocksAt ниже и её использование).
    headerBlocks: blocks
      .filter(b => b.block_label === 'header' && Array.isArray(b.block_bbox))
      .map(b => ({ text: (b.block_content ?? '').trim(), y: b.block_bbox[1] })),
    textBlockYs: blocks
      .filter(b => b.block_label === 'text' && Array.isArray(b.block_bbox))
      .map(b => b.block_bbox[1]),
  }
})

// Вставляет "потерянные" header-блоки страницы в markdown перед тем текстовым
// параграфом (разделённым "\n\n"), который в исходной вёрстке идёт следом за
// header'ом по вертикальной координате — иначе можно только добавить в самое
// начало страницы, что неверно, если на странице несколько header-блоков
// в разных местах (варианты/работы дидактических сборников, где заголовок
// печатается перед каждым вариантом, не только в начале страницы).
function insertHeaderBlocksAt(page, predicate) {
  const toInsert = page.headerBlocks.filter(predicate)
  if (toInsert.length === 0) return
  const paragraphs = page.markdown.split('\n\n')
  let inserted = 0
  for (const h of toInsert) {
    if (!h.text) continue
    // индекс текстового блока, идущего сразу после этого header по y-координате
    // (+inserted — компенсирует сдвиг индексов от уже вставленных ранее header'ов
    // этой же страницы, иначе второй и последующие встают на устаревшую позицию)
    const paraIdx = page.textBlockYs.filter(y => y < h.y).length + inserted
    const at = Math.min(paraIdx, paragraphs.length)
    // «уже есть» проверяем ЛОКАЛЬНО (соседний параграф), не по всей странице —
    // дидактические сборники повторяют один и тот же заголовок ("K-2 (§ 3, 4)")
    // несколько раз на странице (перед каждым вариантом), и глобальная проверка
    // ложно посчитала бы второе вхождение уже вставленным из-за первого
    if (paragraphs[at]?.includes(h.text) || paragraphs[at - 1]?.includes(h.text)) continue
    paragraphs.splice(at, 0, `##### ${h.text}`)
    inserted++
  }
  page.markdown = paragraphs.join('\n\n')
}

// ── Normalization ────────────────────────────────────────────────────────────

// OCR-артефакты подпунктов: латиница/цифры вместо кириллицы в маркерах "а) б) в) г) д) е)".
// Одна и та же латинская буква в разных книгах означает разные кириллические
// (b→б у Макарычева, b→в у Мордковича, где б распознан как 6), поэтому маркеры
// нормализуются ЦЕПОЧКОЙ: следующий маркер должен продолжать а→б→в→г→д→е,
// и буква интерпретируется по позиции в цепочке, а не по одиночной карте.
const CHAIN = ['а', 'б', 'в', 'г', 'д', 'е']
// Возможные кириллические буквы для каждого OCR-символа маркера
const POSSIBLE = {
  a: ['а'], 'а': ['а'],
  '6': ['б'], 'б': ['б'],
  b: ['б', 'в'], B: ['б', 'в'],
  'в': ['в'], c: ['в'], s: ['в'], S: ['в'], v: ['в'],
  r: ['г'], 'Γ': ['г'], 'г': ['г'], g: ['г'],
  d: ['г', 'д'], D: ['д'], 'д': ['д'],
  e: ['е'], E: ['е'], f: ['е'], 'е': ['е'],
}
// Маркер = буква + ")" в начале строки или после ; : . — по границам перечисления.
const MARKER_RE = /(^[ \t]*|[;:.]\s+)([a-zA-Zа-е6Γ])\)(?=[ \t]|$)/gm

// Подпункты одного задания образуют кластер из букв а..е, но порядок в OCR
// может отличаться от алфавитного (двухколоночная вёрстка читается как
// а, в, б, г). Буквы назначаем методом исключения: сначала однозначные
// символы (6→б, r→г, a→а), затем неоднозначные (b — б или в) получают
// оставшиеся буквы кластера.
function chainNormalizeMarkers(text) {
  const cands = []
  let m
  MARKER_RE.lastIndex = 0
  while ((m = MARKER_RE.exec(text)) !== null) {
    if (POSSIBLE[m[2]]) cands.push({ at: m.index + m[1].length, ch: m[2] })
  }

  const clusters = []
  let cur = null
  for (const c of cands) {
    const isA = POSSIBLE[c.ch].length === 1 && POSSIBLE[c.ch][0] === 'а'
    if (isA || !cur || c.at - cur[cur.length - 1].at > 600 || cur.length >= CHAIN.length) {
      if (cur) clusters.push(cur)
      cur = isA ? [c] : null // кластер начинается только с "а)"; одиночные маркеры вне кластера не трогаем
    } else {
      cur.push(c)
    }
  }
  if (cur) clusters.push(cur)

  const repl = [] // {at, letter}
  for (const cluster of clusters) {
    if (cluster.length < 2) continue
    const letters = CHAIN.slice(0, cluster.length)
    const assigned = new Array(cluster.length).fill(null)
    const used = new Set()
    let changed = true
    while (changed) {
      changed = false
      for (let i = 0; i < cluster.length; i++) {
        if (assigned[i]) continue
        const opts = POSSIBLE[cluster[i].ch].filter(l => letters.includes(l) && !used.has(l))
        if (opts.length === 1) { assigned[i] = opts[0]; used.add(opts[0]); changed = true }
      }
    }
    for (let i = 0; i < cluster.length; i++) { // остаток — первая свободная из возможных
      if (assigned[i]) continue
      const pick = POSSIBLE[cluster[i].ch].find(l => !used.has(l))
      if (pick) { assigned[i] = pick; used.add(pick) }
    }
    for (let i = 0; i < cluster.length; i++) {
      if (assigned[i] && assigned[i] !== cluster[i].ch) repl.push({ at: cluster[i].at, letter: assigned[i] })
    }
  }
  if (repl.length === 0) return text

  repl.sort((x, y) => x.at - y.at)
  let out = ''
  let pos = 0
  for (const { at, letter } of repl) {
    out += text.slice(pos, at) + letter
    pos = at + 1 // маркер — ровно один символ
  }
  return out + text.slice(pos)
}

function normalizeMarkers(md) {
  // " $ \Gamma $ " как маркер г)
  return chainNormalizeMarkers(md.replace(/^\s*\$\s*\\Gamma\s*\$\s*/gm, 'г) '))
}

// OCR местами заворачивает строку задания целиком в LaTeX:
// "$$\circ\mathbf{12.2.a)}\begin{cases}y=1-7x,\\4x-y=32;\end{cases}$$"
// Распутываем: номер и маркеры подпунктов наружу, формулы обратно в $...$.
function unwrapMathTaskLine(line) {
  let t = line
  for (let i = 0; i < 5; i++) {
    const b = t
    t = t.replace(/\\(?:mathbf|mathrm|mathtt|mathit|boldsymbol|operatorname|text)\s*\{([^{}]*)\}/g, '$1')
    if (t === b) break
  }
  t = t
    .replace(/\\circ/g, '○').replace(/\\infty/g, '∞')
    .replace(/\\[:;,!]|\\quad|\\qquad/g, ' ')
    .replace(/~/g, ' ')
    .replace(/\$\$?/g, ' ')

  const pm = t.match(/^\s*([○∞oOоОοΟ0])?\s*(\d{1,2})\.(\d{1,3})\.\s*/)
  if (!pm) return line // номер не в начале строки — не рискуем
  const rest = t.slice(pm[0].length)

  // сегмент математики → $...$; текст и голые числа не оборачиваем
  const wrap = (s) => {
    s = (s ?? '').trim()
    if (!s) return ''
    const m2 = s.match(/^(.*?)([;.,]*)$/s)
    const body = m2[1].trim()
    if (!body) return m2[2]
    if (/[А-Яа-яЁё]{2,}/.test(body) || !/[\\^_{}=<>+]|\d\s*[-/]\s*\d/.test(body)) return s
    return `$${body}$${m2[2]}`
  }

  // подпункты: маркер = буква+")" в начале либо после ; или }
  const markers = [...rest.matchAll(/(^|[;}]\s*)([а-еa-z6ΓB])\)\s*/g)]
  let out = `${pm[1] ?? ''}${pm[2]}.${pm[3]}. `
  if (markers.length === 0) {
    out += wrap(rest)
  } else {
    let pos = 0
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i]
      const lead = rest.slice(pos, m.index + m[1].length).trim()
      if (lead) out += wrap(lead) + ' '
      const contentEnd = i + 1 < markers.length ? markers[i + 1].index + markers[i + 1][1].length : rest.length
      out += `${m[2]}) ${wrap(rest.slice(m.index + m[0].length, contentEnd))} `
      pos = contentEnd
    }
  }
  return out.trimEnd()
}

// Продолжение задания, завёрнутое в display-math без номера:
// "$$\mathbf{6})2\frac{1}{2}+…;\qquad\mathbf{r})…$$" → "б) $…$; г) $…$"
// (та же распаковка, но без номерного префикса)
function unwrapMathMarkerLine(line) {
  let t = line
  for (let i = 0; i < 5; i++) {
    const b = t
    t = t.replace(/\\(?:mathbf|mathrm|mathtt|mathit|boldsymbol|operatorname|text)\s*\{([^{}]*)\}/g, '$1')
    if (t === b) break
  }
  t = t
    .replace(/\\circ/g, '○').replace(/\\infty/g, '∞')
    .replace(/\\[:;,!]|\\quad|\\qquad/g, ' ')
    .replace(/~/g, ' ')
    .replace(/\$\$?/g, ' ')

  const wrap = (s) => {
    s = (s ?? '').trim()
    if (!s) return ''
    const m2 = s.match(/^(.*?)([;.,]*)$/s)
    const body = m2[1].trim()
    if (!body) return m2[2]
    if (/[А-Яа-яЁё]{2,}/.test(body) || !/[\\^_{}=<>+]|\d\s*[-/]\s*\d/.test(body)) return s
    return `$${body}$${m2[2]}`
  }
  const markers = [...t.matchAll(/(^\s*|[;}]\s*)([а-еa-z6ΓB])\)\s*/g)]
  if (markers.length === 0) return line // маркеров нет — не наш случай
  let out = ''
  let pos = 0
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i]
    const lead = t.slice(pos, m.index + m[1].length).trim()
    if (lead) out += wrap(lead) + ' '
    const contentEnd = i + 1 < markers.length ? markers[i + 1].index + markers[i + 1][1].length : t.length
    out += `${m[2]}) ${wrap(t.slice(m.index + m[0].length, contentEnd))} `
    pos = contentEnd
  }
  return out.trimEnd()
}

// Правило проекта: структуру учебника не воспроизводим дословно — упрощаем
// до читаемого вида. Короткие display-формулы без переносов → инлайн $…$,
// чтобы они не растягивали строку и не давали горизонтальный скролл.
function inlineShortDisplayMath(md) {
  return md.replace(/\$\$\s*([^$]+?)\s*\$\$/g, (m, body) => {
    if (body.length > 110 || /\\begin|\\\\|\n/.test(body)) return m
    return `$${body}$`
  })
}

function unwrapMathTasks(md) {
  return md.split('\n').map(line => {
    const hasWrapper = /\\(?:circ|mathbf|mathrm|mathtt|boldsymbol)/.test(line)
    if (!hasWrapper) return line
    if (/\d{1,2}\.\d{1,3}\./.test(line.slice(0, 80))) return unwrapMathTaskLine(line)
    // display-math строка с маркерами подпунктов, но без номера задания
    if (/^\s*\$\$?/.test(line) && /\\math\w+\{?\s*[а-еa-z6ΓB]\s*\}?\s*\)/.test(line)) {
      return unwrapMathMarkerLine(line)
    }
    return line
  }).join('\n')
}

function rewriteImages(md, images) {
  let out = md
  for (const [key, url] of Object.entries(images)) {
    out = out.replaceAll(`src="${key}"`, `src="${url}"`)
  }
  return out
}

// OCR иногда рендерит открывающую строку задания как markdown-заголовок
// ("## 65 Найди значения выражений:", т.к. в PDF номер набран крупным/жирным
// шрифтом) — снимаем "#", иначе задание визуально выделяется как заголовок
// раздела, а не как обычный текст, и теряется извлечением по номеру.
function demoteHeadingTaskNumbers(md) {
  return md.split('\n').map(line => {
    const m = line.match(/^(#{1,6})[ \t]+(.*)$/)
    if (!m) return line
    const rest = m[2]
    const looksLikeTask = /^(?:[КПДСKPDCπoOоОοΟ0][ \t]+)?\d{1,4}[*°]?(?:[.)][ \t]+|[ \t]+[А-ЯЁ$«(])/.test(rest)
    return looksLikeTask ? rest : line
  }).join('\n')
}

for (const p of pages) {
  p.markdown = rewriteImages(normalizeMarkers(inlineShortDisplayMath(demoteHeadingTaskNumbers(unwrapMathTasks(p.markdown)))), p.images)
}

// printed page → scan index
const printedToIndex = new Map()
for (const p of pages) {
  if (p.printed !== null && !printedToIndex.has(p.printed)) printedToIndex.set(p.printed, p.index)
}

// ── TOC (печатное оглавление из content-блоков) ──────────────────────────────

// OCR иногда превращает "Глава N." в греческую кашу ("Για να δ.")
const tocText = pages.flatMap(p => p.contentBlocks).join('\n')
  .replace(/^Γ[ιi]α\s*να\s*δ[.,]?\s*/gim, 'Глава ')
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
    // "Глава N" — заголовок либо на той же строке (Мордкович:
    // "Глава 1. МАТЕМАТИЧЕСКИЙ ЯЗЫК"), либо на следующей (Макарычев)
    const chapterMatch = line.match(/^(?:Глава|Плава|Гл\s*ава)(?![а-яё])\s*(\d+)?\s*[.:]?\s*(.*)$/i)
    if (chapterMatch) {
      pending = ''
      const number = chapterMatch[1] ?? String(sections.filter(s => s.kind === 'chapter').length + 1)
      let title = chapterMatch[2].trim()
      let printedPage = null
      if (title) {
        const tm = title.match(/^(.*?)\s*\.{2,}\s*(\d+|—)\s*$/)
        if (tm) {
          title = tm[1].trim()
          printedPage = tm[2] !== '—' ? parseInt(tm[2]) : null
        }
      } else {
        const titleLine = lines[i + 1] ?? ''
        const tm = titleLine.match(/^(.*?)\s*\.{2,}\s*(\d+|—)\s*$/)
        title = tm ? tm[1].trim() : titleLine.trim()
        printedPage = tm && tm[2] !== '—' ? parseInt(tm[2]) : null
        if (tm) i++ // заголовок главы поглощён
      }
      chapter = { kind: 'chapter', number, title, printedPage, children: [] }
      if (chapter.printedPage) lastPage = chapter.printedPage
      sections.push(chapter)
      paragraph = null
      continue
    }
    const m = line.match(/^(.*?)\s*\.{2,}\s*(\d+|—)\s*$/)
    if (!m) {
      // "§ N. Title." без отточия и номера страницы (Петерсон) — параграф
      // открывается сразу; его page_start подтянется от первого пункта
      const barePara = line.match(/^§\s*(\d+)\.\s*(.+?)\.?\s*$/)
      if (barePara) {
        paragraph = { kind: 'paragraph', number: `§ ${barePara[1]}`, title: barePara[2], printedPage: null, children: [] }
        ;(chapter?.children ?? sections).push(paragraph)
        pending = ''
        continue
      }
      // "N. Title" без отточия, законченное на этой же строке (не обрезано
      // переносом) — тот же дефект OCR, что у barePara, но для пункта:
      // отточия «.....N» на всей странице потеряны (см. Атанасян, стр. 412 —
      // главы V-VII напечатаны вовсе без номеров страниц в оглавлении).
      // printedPage=null здесь восстанавливается позже фолбэком по
      // paragraph_title-блокам самих страниц (см. resolveMissingPrintedPages).
      const barePunkt = line.match(/^(\d{1,3})\.\s*(.+?)\.?\s*$/)
      if (barePunkt && paragraph && parseInt(barePunkt[1]) > 0) {
        paragraph.children.push({ kind: 'punkt', number: barePunkt[1], title: barePunkt[2], printedPage: null, children: [] })
        pending = ''
        continue
      }
      // Заголовки-разделители без номера страницы, тоже законченные на
      // строке — иначе тянутся в pending и текут в заголовок следующего
      // реального узла (см. тот же дефект OCR)
      if (/^(Задачи|Дополнительные\s+задачи|Практические\s+(задания|задачи)|Вопросы\s+для\s+повторения(\s+к\s+главе.*)?|Задачи\s+повышенной\s+трудности)\s*$/i.test(line)) {
        const kind = /^Дополнительные/i.test(line) ? 'extra' : 'other-inline'
        if (kind === 'extra') { (chapter?.children ?? sections).push({ kind: 'extra', number: null, title: line, printedPage: null, children: [] }) }
        // «Задачи»/«Практические задания»/«Вопросы для повторения» сами по
        // себе не заводят TOC-узел (как и в ветке с отточием ниже — see
        // строка ~432 "else" не создаёт для них ничего) — просто закрываем
        // текущий pending, чтобы он не приклеился к следующему заголовку
        pending = ''
        continue
      }
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
    } else if (/^Дополнительные упражнения/i.test(title) || /^Домашн[а-яё]*\s+контрольн/i.test(title)) {
      ;(chapter?.children ?? sections).push({ kind: 'extra', number: null, title, printedPage: page, children: [] })
      paragraph = null
    } else if (/^(Задачи|Дополнительные\s+задачи|Практические\s+(задания|задачи)|Вопросы\s+для\s+повторения(\s+к\s+главе.*)?|Задачи\s+повышенной\s+трудности)\s*$/i.test(title)) {
      // Та же ветка-исключение, что и выше для строк БЕЗ отточия (строка
      // ~446) — но эта строка отточие имеет («Практические задания ..... 8»).
      // БАГ, который она чинит: до этого фикса такая строка проваливалась в
      // "else" ниже (Предисловие/Ответы/Указатель) и ОШИБОЧНО обнуляла и
      // chapter, и paragraph — все параграфы/пункты ПОСЛЕ первого "Практические
      // задания"/"Задачи" любой главы становились root-level узлами вместо
      // детей главы, из-за чего --grade-by-chapter не мог унаследовать класс
      // (см. Атанасян: "§ 2. Луч и угол" и все параграфы после первого
      // теряли родителя). Сам узел не заводим — только сохраняем chapter/
      // paragraph как есть.
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

// ── Дидактические сборники (--type didactic) ────────────────────────────────
// Класс источников «СР/КР/ПР по вариантам»: печатного оглавления может не быть
// вовсе, структура и зоны нумерации восстанавливаются из заголовков страниц.
const isDidactic = (flag('type') ?? '') === 'didactic'

// «Самостоятельная/Контрольная/Проверочная работа …» (ед. число, чтобы не
// цеплять части «САМОСТОЯТЕЛЬНЫЕ РАБОТЫ») и «К-15 (…)» — заголовки работ
// внимание: \b в JS не работает с кириллицей ([а-яё] ∉ \w) — границу слова
// «работа» задаём негативным просмотром
// "Самостоятельная\n\nработа" — колонтитул иногда попадает в OCR не отдельным
// "header"-блоком (см. insertHeaderBlocksAt), а слитым в обычный text-блок с
// переносом абзаца между прилагательным и "работа" (см. Кирик, стр.53/126:
// эпиграф над колонтитулом занимает верх страницы, и оба слова расходятся по
// разным параграфам markdown) — [ \t]+ (одна строка) не матчит перенос,
// \s{1,4} — допускает пустую строку между ними, не более.
const WORK_RE = /^#{0,6}[ \t]*((?:Вводн[а-яё]+[ \t]+|Итогов[а-яё]+[ \t]+|Примерн[а-яё]+[ \t]+)?(Самостоятельн|Контрольн|Проверочн)[а-яё]*\s{1,4}работа(?![а-яё])[^\n]*)/gim
// «K-1 (Виленкин, п. 7)» — заголовок КР; бывает и обычной строкой без «#»,
// поэтому требуем строку целиком: номер + необязательная скобочная пометка
const KR_HEAD_RE = /^#{0,6}[ \t]*[KК][ \t]*[-–—][ \t]*(\d+)[ \t]*(\([^\n)]{0,80}\))?[ \t]*$/gm
// Короткая форма «С-N. Тема» / «К-N (§...). Тема» на одной строке с темой
// (Макарычев «Дидактические материалы», не требует слова «работа» вовсе), а
// также двухбуквенная «СР-N. Тема» (кириллица) / «CP-N. Тема» (латиница —
// OCR иногда путает визуально идентичные С/C, Р/P) — «Самостоятельная
// Работа», см. Громцева «Физика 8 класс»: там СР-N используется вместо
// однобуквенного С-N всюду по книге. Перед шифром печатается номер варианта
// римской цифрой — OCR искажает его как что угодно (1, I, П, T, 7, И…) —
// съедаем произвольный короткий префикс (не С/К/C/P, чтобы случайно не
// проглотить сам шифр работы); сам номер варианта отсюда не берём (его даёт
// TOC-секция «Вариант N» или рестарт нумерации 1.. внутри работы, см.
// didState.variant++).
//
// Оглавление печатает ЭТИ ЖЕ строки в сокращённом виде («CP-1. Тепловое
// движение...... 6») на 1-2 страницах перед реальным текстом заданий —
// PaddleOCR размечает TOC как block_label='content', но content НЕ входит в
// markdown_ignore_labels, поэтому он всё равно остаётся в markdown.text и
// ложно матчится тем же паттерном (см. Громцева «Физика 8 класс», где это
// давало 48 фиктивных "работ" раньше первой настоящей — коллизии printedNo
// с реальными заголовками дальше по документу рвали нумерацию у всех работ
// после ~6-й). Строка оглавления узнаётся по отточию «.....N» в конце —
// исключаем её негативным lookahead в самом хвосте.
const SHORT_WORK_HEAD_RE = /^#{0,6}[ \t]*(?:[^\sСКCскPp\n]{1,3}[ \t]+)?([СC][РP]|[СКCск])[ \t]*[-–—.][ \t]*(\d+)[.)][ \t]*([^\n]{2,120})$/gm
const TOC_LIKE_LINE_RE = /\.{2,}\s*\d{1,3}[ \t]*$/
const KIND_BY_WORD = { 'самостоятельн': 'с', 'контрольн': 'р', 'проверочн': 'п' }
const KIND_BY_LETTER = { с: 'с', к: 'р' } // сравнение по нижнему регистру (С/К/C и их OCR-варианты в верхнем/нижнем)
// Заголовок работы, обёрнутый переносом на несколько строк ("CP-28. Тема...
// \nпродолжение темы .....63"), не ловится TOC_LIKE_LINE_RE — отточие
// оказывается на другой физической строке, чем начало заголовка (см.
// Громцева, стр.4 оглавления). Общий признак страницы целиком — высокая
// ДОЛЯ строк с отточием (обычный текст задания такого почти не содержит,
// а TOC — почти весь), надёжнее одной строки.
function isTocLikePage(markdown) {
  const lines = markdown.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 4) return false
  const tocLines = lines.filter(l => TOC_LIKE_LINE_RE.test(l)).length
  return tocLines / lines.length >= 0.2
}

// Дидактические сборники (Макарычев «Дидактические материалы» и, вероятно,
// не только) печатают заголовок каждого варианта/работы ("Вариант 3"/"K-2
// (§ 3, 4)") на КАЖДОЙ странице — но PaddleOCR распознаёт их как служебный
// "header" (колонтитул), который в markdown.text не попадает вовсе (та же
// природа, что у "Итогового повторения", см. repetitionSection выше, но
// заголовков на странице несколько и они не все в начале — поэтому нужна
// позиционная вставка insertHeaderBlocksAt, а не "в начало страницы").
// Без этого фикса варианты 3-4 каждой работы теряют заголовки полностью,
// а варианты 2-4 остаются с ЛОЖНЫМИ номерами прямо в markdown-тексте (см.
// project_books_module: "Вариант 2"/"Вариант 4" печатались там как позиция
// внутри пары страниц, а не абсолютный номер варианта).
if (isDidactic) {
  for (const p of pages) insertHeaderBlocksAt(p, () => true)
}

const didacticWorks = [] // {page, at, title, kind, printedNo, no, globalIdx}
// Раздел книги иногда открывается шмуцтитулом-анонсом — несколько заголовков
// "Контрольная работа № N" подряд с кратким перечнем тем, БЕЗ единого
// задания между ними (см. Кирик, стр.161: "Контрольная работа № 1 • Тема...
// Контрольная работа № 2 • Тема..." и т.д.). Без фильтра эти 4 фиктивные
// "работы" со своими, ПРАВИЛЬНЫМИ printedNo 1-4 конкурируют за те же номера
// с настоящими работами дальше по документу — настоящие проигрывают
// коллизию (usedKey ниже) и съезжают на случайные следующие номера.
// Признак: >1 совпадения WORK_RE на одной физической странице — считаем всю
// страницу анонсом целиком (сами работы никогда не печатаются по нескольку
// на одну scan-страницу в этой книге).
if (isDidactic) {
  for (const p of pages) {
    if (isTocLikePage(p.markdown)) continue // страница оглавления — не искать здесь заголовки работ
    let m
    const workMatchesOnPage = []
    WORK_RE.lastIndex = 0
    while ((m = WORK_RE.exec(p.markdown)) !== null) {
      if (TOC_LIKE_LINE_RE.test(m[1])) continue // строка оглавления («Контрольная работа .....30»)
      workMatchesOnPage.push(m)
    }
    if (workMatchesOnPage.length > 1) continue // шмуцтитул-анонс, не реальные заголовки
    for (const wm of workMatchesOnPage) {
      const title = wm[1].trim()
      didacticWorks.push({
        page: p.index, at: wm.index, title,
        kind: KIND_BY_WORD[wm[2].toLowerCase()] ?? 'р',
        printedNo: parseInt(title.match(/№\s*(\d+)/)?.[1] ?? '') || null,
      })
    }
    KR_HEAD_RE.lastIndex = 0
    while ((m = KR_HEAD_RE.exec(p.markdown)) !== null) {
      didacticWorks.push({
        page: p.index, at: m.index,
        title: `К-${m[1]}${(m[2] ?? '').trim() ? ' ' + m[2].trim() : ''}`,
        kind: 'р', printedNo: parseInt(m[1]),
      })
    }
    SHORT_WORK_HEAD_RE.lastIndex = 0
    while ((m = SHORT_WORK_HEAD_RE.exec(p.markdown)) !== null) {
      if (TOC_LIKE_LINE_RE.test(m[3])) continue // строка оглавления («Тема .....N»), не заголовок задания
      const kind = KIND_BY_LETTER[m[1].toLowerCase()] ?? 'с'
      // латиница "C" и кириллица "С" визуально идентичны, но разные символы —
      // нормализуем к кириллице, иначе заголовки той же работы на разных
      // страницах ("C-1" vs "С-1") не схлопнутся по title ниже
      const letter = kind === 'с' ? 'С' : 'К'
      didacticWorks.push({
        page: p.index, at: m.index,
        title: `${letter}-${m[2]}. ${m[3].trim()}`,
        kind, printedNo: parseInt(m[2]),
      })
    }
  }
  // Заголовок раздела без С-N/К-N-структуры, но с «Вариант N» внутри
  // («Итоговый тест» — тестовые вопросы с выбором ответа, 2 варианта,
  // рестарт нумерации — та же структура, что у контрольных работ, просто
  // без обёртки К-N) — добавляем как ОДНУ синтетическую работу на диапазон
  // до следующего "#"-заголовка того же или большего уровня, иначе variant/
  // рестарт-логика не подхватывает её (didState.work === null). flatSections
  // (TOC) здесь ещё не готов (вычисляется позже) — ищем прямо по markdown.
  const TOP_HEADING_RE = /^#{1,3}[ \t]+([^\n]{2,80})$/gm
  const hasVariantHeaderRe = /^#{0,6}\s*[БВB][а-яёa-z]{4,9}\s+\d\s*\.?\s*$/gim
  const SYNTHETIC_WORK_EXCLUDE_RE = /домашн[а-яё]*\s+контрольн|оглавлени|содержани|приложени|предисловие|предметный указатель|справочный материал|ответ|повышенной трудности|итогов[а-яё]*\s+повторени|самостоятельн|контрольн/i
  for (const p of pages) {
    TOP_HEADING_RE.lastIndex = 0
    let hm
    while ((hm = TOP_HEADING_RE.exec(p.markdown)) !== null) {
      const title = hm[1].trim()
      if (SYNTHETIC_WORK_EXCLUDE_RE.test(title)) continue
      if (didacticWorks.some(w => w.page === p.index)) continue // страница уже начата известной работой
      // диапазон секции — от этого заголовка до конца страницы, куда доходит
      // рестарт-логика сама (следующий "work"-заголовок её остановит) —
      // достаточно просто застолбить страницу как начало синтетической работы
      hasVariantHeaderRe.lastIndex = 0
      if (!hasVariantHeaderRe.test(p.markdown.slice(hm.index))) continue
      didacticWorks.push({ page: p.index, at: hm.index, title, kind: 'т', printedNo: null })
      break // одна синтетическая работа на страницу достаточно
    }
  }
  didacticWorks.sort((a, b) => a.page - b.page || a.at - b.at)

  // Восстановление printedNo из оглавления для книг, где сам номер работы
  // НЕ печатается в тексте задания вовсе — только в TOC (см. Кирик «Физика
  // 8 кл. Разноуровневые работы»: колонтитул на каждой странице — голое
  // "Самостоятельная работа" без номера и темы; тема есть только в doc_title
  // рядом, но тоже без номера работы). Без этого шага WORK_RE находит
  // одинаковый текст "Самостоятельная работа" у РАЗНЫХ работ, и дедупликация
  // ниже (ключ — printedNo, а при его отсутствии — текст заголовка) схлопывает
  // соседние работы (та, что окажется в пределах 6 страниц) в одну — реальный
  // случай: СР-1 и СР-2 слились, а дальше ещё 6 работ подряд.
  // TOC печатает "Самостоятельная работа № N" (или "Контрольная работа № N")
  // ПОЛНЫМ текстом на своей строке — сопоставляем по ближайшей scan-странице.
  const tocWorkNodes = toc
    .map(n => {
      const m = String(n.title ?? '').match(/(Самостоятельная|Контрольная)\s+работа\s*№\s*(\d+)/i)
      if (!m) return null
      const scanPage = n.scanStart ?? printedToScan(n.printedPage)
      if (scanPage === null) return null
      return { kind: m[1].toLowerCase() === 'самостоятельная' ? 'с' : 'р', no: parseInt(m[2]), scanPage }
    })
    .filter(Boolean)
  if (tocWorkNodes.length > 0) {
    for (const w of didacticWorks) {
      if (w.printedNo !== null) continue
      // ближайший TOC-узел ТОГО ЖЕ вида работы в пределах 3 страниц (работа
      // может начинаться на следующей физической странице после заголовка TOC)
      const candidates = tocWorkNodes
        .filter(t => t.kind === w.kind && Math.abs(t.scanPage - w.page) <= 3)
        .sort((a, b) => Math.abs(a.scanPage - w.page) - Math.abs(b.scanPage - w.page))
      if (candidates.length > 0) w.printedNo = candidates[0].no
    }
  }

  // Одна работа печатает заголовок над каждым вариантом («K-1 …» ×4) —
  // повторы в пределах 6 страниц схлопываются в одну. Ключ — kind+printedNo
  // (номер работы), не полный текст заголовка: скобочный комментарий у одной
  // и той же работы иногда распознаётся OCR по-разному на разных страницах
  // («К-9 (итогов ван)» vs «К-9 (итогов вя)» — оба искажения «ИТОГОВАЯ»),
  // а сам номер работы обычно стабилен. Без printedNo (совсем не распознан
  // номер) откатываемся на текст заголовка — как раньше.
  const byTitle = new Map()
  for (const w of didacticWorks) {
    const keyT = w.printedNo != null ? `${w.kind}${w.printedNo}` : w.title.toLowerCase().replace(/\s+/g, ' ')
    const prev = byTitle.get(keyT)
    if (prev && w.page - prev.lastPage <= 6) {
      prev.lastPage = w.page
      w.resolved = prev
    } else {
      w.lastPage = w.page
      w.resolved = w
      byTitle.set(keyT, w)
    }
  }
  const uniqueWorks = didacticWorks.filter(w => w.resolved === w)

  // глобальный индекс (порядок в документе) + разрешение коллизий печатных
  // номеров: вторая серия К-1..К-14 (другой учебник) получает следующие номера
  const usedKey = new Set()
  const maxOfKind = {}
  uniqueWorks.forEach((w, i) => {
    w.globalIdx = i + 1
    let no = w.printedNo ?? (maxOfKind[w.kind] ?? 0) + 1
    if (usedKey.has(`${w.kind}${no}`)) no = (maxOfKind[w.kind] ?? 0) + 1
    w.no = no
    usedKey.add(`${w.kind}${no}`)
    maxOfKind[w.kind] = Math.max(maxOfKind[w.kind] ?? 0, no)
  })

  // Обогащение оглавления: части из h1/h2-заголовков (если печатного TOC нет),
  // работы — детьми ближайшей части
  if (toc.length === 0) {
    for (const p of pages) {
      for (const m of p.markdown.matchAll(/^#{1,2}[ \t]+([^\n]{4,120})$/gm)) {
        const t = m[1].trim()
        const isWork = didacticWorks.some(w => w.page === p.index && t.includes(w.title.slice(0, 25)))
        if (isWork || /^вариант\b/i.test(t)) continue
        toc.push({ kind: 'other', number: null, title: t, printedPage: null, scanStart: p.index, children: [] })
      }
    }
  }
  const rootScan = (s) => s.scanStart ?? null
  for (const w of uniqueWorks) {
    // ближайшая корневая секция выше по документу
    let best = null
    for (const s of toc) {
      const sc = rootScan(s) ?? (s.printedPage !== null ? s.printedPage : null)
      if (sc !== null && sc <= w.page && (!best || sc >= (rootScan(best) ?? best.printedPage ?? 0))) best = s
    }
    // не дублируем секцию, если работа уже есть в печатном TOC (Проверочные у Чеснокова)
    if (best && (rootScan(best) ?? -1) === w.page && best.title.toLowerCase().includes(w.title.slice(0, 12).toLowerCase())) continue
    const node = { kind: 'exercises', number: null, title: w.title, printedPage: null, scanStart: w.page, children: [] }
    ;(best?.children ?? toc).push(node)
  }
}

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
    n.pageStart = n.scanStart ?? printedToScan(n.printedPage)
    flatSections.push(n)
    walk(n.children, n)
  }
})(toc, null)

// Фолбэк для узлов, у которых OCR не дал printedPage вовсе (оглавление
// местами теряет отточия "…N" целыми страницами — см. Атанасян, стр. 412:
// главы V-VII напечатаны без единого номера страницы). Заголовки глав/
// параграфов/пунктов при этом реально печатаются В ТЕКСТЕ САМОЙ КНИГИ как
// чистый "paragraph_title"-блок (page.titles) — ищем совпадение там,
// в границах между соседними УЖЕ известными узлами document-order, чтобы
// не поймать одноимённый пункт из другой главы.
function resolveMissingPageStarts(sections) {
  let resolved = 0
  for (let i = 0; i < sections.length; i++) {
    const n = sections[i]
    if (n.pageStart !== null) continue
    const prevKnown = sections.slice(0, i).reverse().find(s => s.pageStart !== null)
    const nextKnown = sections.slice(i + 1).find(s => s.pageStart !== null)
    const lo = prevKnown?.pageStart ?? 0
    const hi = nextKnown?.pageStart ?? pages.length - 1
    if (hi < lo) continue

    // Ключ поиска в page.titles: "N. Первые_3_слова" для пункта/§,
    // "Глава N" для главы — сравниваем по началу строки без учёта регистра.
    let needle = null
    if (n.kind === 'punkt') needle = new RegExp(`^${n.number}\\.\\s*${n.title.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
    else if (n.kind === 'paragraph') needle = new RegExp(`^§\\s*${String(n.number).replace(/\D/g, '')}\\b`, 'i')
    else if (n.kind === 'chapter') needle = new RegExp(`^Глава\\s*${n.number}\\b`, 'i')
    if (!needle) continue

    for (let idx = lo; idx <= hi; idx++) {
      const p = pages[idx]
      // page.titles = сырой block_content блоков paragraph_title, с markdown-
      // префиксом ("## 39. Свойства…", "#### Глава V") — снимаем перед сравнением
      if (!p || !p.titles.some(t => needle.test(t.replace(/^#+\s*/, '').trim()))) continue
      n.pageStart = idx
      resolved++
      break
    }
  }
  return resolved
}
const resolvedByTitles = resolveMissingPageStarts(flatSections)
if (resolvedByTitles > 0) warnings.push(`Оглавление: ${resolvedByTitles} раздел(ов) без номера страницы восстановлены по заголовкам в тексте книги`)

for (let i = 0; i < flatSections.length; i++) {
  const cur = flatSections[i]
  const next = flatSections.slice(i + 1).find(s => s.pageStart !== null && s.pageStart >= (cur.pageStart ?? 0))
  cur.pageEnd = next?.pageStart != null ? Math.max(cur.pageStart ?? 0, next.pageStart - (next.pageStart > (cur.pageStart ?? 0) ? 1 : 0)) : pages.length - 1
}

// Класс по номеру главы (--grade-by-chapter) — номер считаем ТЕМ ЖЕ
// порядковым счётчиком, что и fallback-нумерация в parseToc (римские "Глава
// V" не матчат \d+ в chapterMatch, там уже используется порядковый номер
// по document order как fallback) — здесь просто повторяем тот же счёт по
// kind==='chapter', чтобы номера совпали 1:1. Дети главы (root-level в toc,
// т.е. без .parent === другая глава дальше по цепочке) наследуют её grade.
if (gradeByChapter) {
  let chapterNo = 0
  const gradeByChapterNo = (no) => gradeByChapter.find(r => no >= r.from && no <= r.to)?.grade ?? null
  const gradeBySection = new Map()
  for (const s of flatSections) {
    if (s.kind === 'chapter') {
      chapterNo++
      gradeBySection.set(s, gradeByChapterNo(chapterNo))
    } else {
      // ближайший родитель-глава вверх по цепочке (parent может быть
      // параграфом/пунктом — поднимаемся, пока не найдём chapter или root)
      let p = s.parent
      while (p && p.kind !== 'chapter') p = p.parent
      gradeBySection.set(s, p ? gradeBySection.get(p) ?? null : null)
    }
    s.grade = gradeBySection.get(s) ?? null
  }
}

// То же для книг без "Глава N" вовсе — параграфы идут плоским root-level
// списком (--grade-by-paragraph). Номер параграфа надёжен (сквозная
// нумерация 1..65 через весь документ), но kind не всегда 'paragraph':
// если в тексте нет "§" (только "1. Название"), parseToc заводит такие
// узлы как kind==='other' с number=null (см. ветку parseToc: без "§"
// первый же пункт не находит родителя-paragraph и падает в else-ветку
// "Предисловие/Ответы/..." — см. Перышкин «Сборник задач. 7-9 кл»,
// где все 65 параграфов именно такие). Номер тогда достаём из начала
// title регэкспом, а не из s.number.
if (gradeByParagraph) {
  const gradeByParagraphNo = (no) => gradeByParagraph.find(r => no >= r.from && no <= r.to)?.grade ?? null
  const paragraphNumber = (s) => {
    if (s.kind === 'paragraph') { const no = parseInt(String(s.number).replace(/\D/g, '')); return Number.isFinite(no) ? no : null }
    // Тематический заголовок-разделитель без отточия слипается с номером
    // следующего параграфа в одну TOC-строку ("ЗАКОНЫ ВЗАИМОДЕЙСТВИЯ И
    // ДВИЖЕНИЯ ТЕЛ 51. Материальная точка…", см. parseToc: разделитель сам
    // не заводит узел — see строка ~446/493) — ищем "N. " не только в самом
    // начале строки, но и после такого префикса (граница слово→цифра).
    if (s.kind === 'other') { const m = String(s.title ?? '').match(/(?:^|\s)(\d{1,3})\.\s/); return m ? parseInt(m[1]) : null }
    return null
  }
  const gradeBySection = new Map()
  for (const s of flatSections) {
    const no = paragraphNumber(s)
    if (no !== null) {
      gradeBySection.set(s, gradeByParagraphNo(no))
    } else {
      let p = s.parent
      while (p && paragraphNumber(p) === null) p = p.parent
      gradeBySection.set(s, p ? gradeBySection.get(p) ?? null : null)
    }
    s.grade = gradeBySection.get(s) ?? null
  }
}

// ── Задания ──────────────────────────────────────────────────────────────────

// Диапазон страниц с ответами (исключаем из поиска заданий) + оглавление
const answersSection = flatSections.find(s => /^(ответы|otbet)/i.test(s.title))

// Некоторые книги (Петерсон) не выносят «Ответы» в оглавление отдельным
// заголовком — раздел просто дописан в конец без титула. Эвристика: с конца
// книги ищем самую раннюю страницу непрерывного хвоста с плотным списком
// «N. значение» (как в разделе ответов) и без иллюстраций (в отличие от
// страниц с заданиями, которые почти всегда содержат картинку-разделитель).
function findHeuristicAnswersStart(allPages) {
  const DOT_RE = /(?<=^|[\s;])(\d{1,4})\.(?=\s|\d)/g
  const dotDensity = (md) => { let n = 0; DOT_RE.lastIndex = 0; while (DOT_RE.exec(md) !== null) n++; return n }
  let i = allPages.length - 1
  while (i >= 0 && (/<img\s/.test(allPages[i].markdown) || dotDensity(allPages[i].markdown) < 6)) i--
  if (i < 0) return null
  let start = i
  for (i -= 1; i >= 0; i--) {
    const md = allPages[i].markdown
    if (/<img\s/.test(md) || dotDensity(md) < 3) break
    start = i
  }
  return start
}
// «Ответы» бывает не выделены в TOC отдельной строкой вовсе (Атанасян:
// OCR потерял отточие у этой строки оглавления так же, как терял их у
// глав V-VII, см. resolveMissingPageStarts выше — но там заголовок хотя бы
// печатается в тексте страницы явно, здесь строки в TOC для «Ответов»
// просто нет физически). Ищем заголовок «# Ответы…»/«# Otbet…» прямо в
// тексте страниц — надёжнее, чем TOC, и не привязано к конкретной книге:
// любая книга с потерянной строкой оглавления получает этот же фолбэк
// раньше, чем совсем грубая эвристика «плотный хвост с конца книги» ниже
// (та при этом сама уязвима: у книг, где ПОСЛЕ ответов идёт ещё и
// предметный указатель — тоже плотный список «Термин N» — эвристика с
// конца видит более длинный/поздний хвост указателя и останавливается там,
// пропуская настоящее начало ответов).
function findAnswersHeading(allPages) {
  const HEAD_RE = /^#{1,6}[ \t]*(ответы|otbet)/im
  for (const p of allPages) if (HEAD_RE.test(p.markdown)) return p.index
  return null
}
// Гейт по isDidactic: у уже отгруженных дидактических сборников (Кубышева,
// Чесноков) ответов нет вовсе — эвристика для них не запускается, чтобы не
// внести регресс. Для книг с явным «Ответы» в TOC эвристика не вызывается
// вовсе (короткое замыкание ??).
const answersStart = answersSection?.pageStart
  ?? (!isDidactic ? findAnswersHeading(pages) : null)
  ?? (!isDidactic ? findHeuristicAnswersStart(pages) : null)
// конец ответов = начало следующего раздела книги (Предметный указатель,
// Справочный материал...) либо конец книги
const afterAnswersStarts = answersStart !== null
  ? flatSections.filter(s => s.pageStart !== null && s.pageStart > answersStart && s !== answersSection).map(s => s.pageStart)
  : []
const answersEnd = afterAnswersStarts.length > 0 ? Math.min(...afterAnswersStarts) - 1 : pages.length - 1
// «Задачи повышенной трудности» — раздел в конце КАЖДОЙ главы (не один на
// всю книгу): печатное оглавление обычно содержит лишь ОДНУ такую строку
// (Атанасян: попадается в оглавлении единожды, для главы IX, хотя реально
// заголовок печатается в тексте 6 раз — по разу в каждой главе, где такой
// блок есть) — единственный flatSections-узел покрывал бы только ОДНУ
// главу, следующие 5 остались бы неопознанными (99→0 в статистике при
// первой попытке починить структуру TOC этой книги).
//
// Верхняя граница диапазона НЕ ищется эвристикой по markdown-заголовкам —
// внутри самого раздела есть подзаголовки той же разметки (шапка «Задачи к
// главам I и II», а у задач на построение — шаблонные «Решение/Анализ/
// Построение/Доказательство»), неотличимые по формату от конца раздела.
// Надёжная граница — начало СЛЕДУЮЩЕЙ ГЛАВЫ из уже построенного TOC-дерева
// (flatSections, kind==='chapter'): раздел «повышенной трудности» физически
// идёт последним в главе, поэтому «до начала следующей главы» — точный
// и простой инвариант, не зависящий от внутренней разметки раздела.
const ADVANCED_HEAD_RE = /^#{0,6}[ \t]*Задачи\s+повышенной\s+трудности[ \t]*$/gim
const chaptersByPageStart = flatSections.filter(s => s.kind === 'chapter' && s.pageStart !== null)
  .sort((a, b) => a.pageStart - b.pageStart)
const advancedRanges = [] // {pageStart, atStart, pageEnd, atEnd (exclusive)}
for (const p of pages) {
  ADVANCED_HEAD_RE.lastIndex = 0
  let m
  while ((m = ADVANCED_HEAD_RE.exec(p.markdown)) !== null) {
    const nextChapter = chaptersByPageStart.find(c => c.pageStart > p.index)
    const endPage = nextChapter ? nextChapter.pageStart : pages.length - 1
    advancedRanges.push({ pageStart: p.index, atStart: m.index, pageEnd: endPage, atEnd: nextChapter ? 0 : Infinity })
  }
}
function isInAdvancedRange(pageIndex, at) {
  return advancedRanges.some(r =>
    (pageIndex > r.pageStart || (pageIndex === r.pageStart && at >= r.atStart)) &&
    (pageIndex < r.pageEnd || (pageIndex === r.pageEnd && at < r.atEnd))
  )
}
// «Итоговое повторение» (Мордкович): глава с собственной сквозной нумерацией 1..N
const repetitionSection = flatSections.find(s => /итогов[а-яё]*\s+повторени/i.test(s.title))

// «Итоговое повторение» местами делится на тематические подразделы со своей
// нумерацией 1..N каждый (см. project_books_module / чек-лист после импорта).
// PaddleOCR обычно размечает заголовок такого подраздела как paragraph_title
// (попадает в markdown как "#####"), но изредка — как служебный "header"
// (колонтитул), и тогда блок вообще не попадает в markdown.text. Достаём его
// оттуда и вставляем перед первым текстовым блоком той же страницы (по y0
// bbox), иначе граница подраздела не видна вовсе и нумерация "рвётся".
// Инструкции вида "Решите неравенство:" тоже иногда размечены как "header" —
// отличаем их по заголовку самой секции (не трогаем) и по признаку заголовка
// раздела (короткая строка без ":" в конце — инструкции всегда кончаются на ":").
// Границы тематических подразделов «Итогового повторения» (если они есть):
// {pageIndex, at, title} по порядку документа. rewriteRepetitionStream()
// ниже сопоставляет им сквозной номер подраздела (1, 2, 3…), нужный, чтобы
// у каждого была своя LIS-последовательность номеров и своя секция в БД.
const repetitionSubsections = []
if (repetitionSection?.pageStart != null) {
  const sameAsSectionTitle = (t) => t.trim().toLowerCase() === repetitionSection.title.trim().toLowerCase()
  for (let idx = repetitionSection.pageStart; idx <= (repetitionSection.pageEnd ?? repetitionSection.pageStart); idx++) {
    const p = pages[idx]
    if (!p) continue
    for (const h of p.headerBlocks) {
      if (!h.text || sameAsSectionTitle(h.text) || /:\s*$/.test(h.text) || /\n/.test(h.text)) continue
      if (p.markdown.includes(h.text)) continue // уже есть в тексте (paragraph_title и т.п.)
      p.markdown = `##### ${h.text}\n\n${p.markdown}`
    }
  }
  for (let idx = repetitionSection.pageStart; idx <= (repetitionSection.pageEnd ?? repetitionSection.pageStart); idx++) {
    const p = pages[idx]
    if (!p) continue
    for (const m of p.markdown.matchAll(/^#{1,6}[ \t]+([^\n]{2,80})$/gm)) {
      const title = m[1].trim()
      if (sameAsSectionTitle(title)) continue // сам заголовок «Итоговое повторение»
      repetitionSubsections.push({ pageIndex: idx, at: m.index, title })
    }
  }
}
// Найден ровно 1 подраздел (или 0) — делить незачем, ведём единый поток 'rep' как раньше
const hasRepetitionSubsections = repetitionSubsections.length >= 2
if (hasRepetitionSubsections) {
  repetitionSubsections.forEach((s, i) => { s.no = i + 1 })
  for (let i = 0; i < repetitionSubsections.length; i++) {
    const cur = repetitionSubsections[i]
    const next = repetitionSubsections[i + 1]
    cur.pageEnd = next ? next.pageIndex : repetitionSection.pageEnd
    const node = {
      kind: 'exercises', number: null, title: cur.title, printedPage: null,
      scanStart: cur.pageIndex, pageStart: cur.pageIndex, pageEnd: cur.pageEnd,
      parent: repetitionSection, children: [], id: undefined,
    }
    cur.section = node
    repetitionSection.children.push(node)
    flatSections.push(node)
  }
}
// подраздел «Итогового повторения», которому принадлежит позиция at на странице pageIndex
function repetitionSubsectionAt(pageIndex, at) {
  let best = null
  for (const s of repetitionSubsections) {
    if (s.pageIndex < pageIndex || (s.pageIndex === pageIndex && s.at <= at)) {
      if (!best || s.pageIndex > best.pageIndex || (s.pageIndex === best.pageIndex && s.at > best.at)) best = s
    }
  }
  return best
}

// Две схемы нумерации (автодетект):
//  plain     — сквозная «735.» (Макарычев)
//  composite — по параграфам «5.30.» (Мордкович); внутри такой книги раздел
//              «Итоговое повторение» нумеруется отдельно сквозными «78.»
// Перед номером допускается значок: ∞/⑤ (повышенная трудность) или кружок
// «задание с ответом», который OCR читает как o/O/о/О/ο/Ο.
const PREFIX = `[ \\t]*(?:([^0-9A-Za-zА-Яа-яЁё#<\\s$([{]|[oOоОοΟ0])[ \\t]{0,2})?`
// после точки — пробел либо сразу маркер подпункта ("o11.10.a)")
const AFTER = `(?:[ \\t]|(?=[а-еa-z6ΓB]\\)))`
const COMPOSITE_RE = new RegExp(`^${PREFIX}(\\d{1,2})\\.(\\d{1,3})\\.${AFTER}`, 'gm')
// «3*.» — звёздочка после номера = повышенная сложность (дидактика)
const PLAIN_RE = new RegExp(`^${PREFIX}(\\d{1,4})([*°]?)\\.${AFTER}`, 'gm')
// Дидактика: часть книг нумерует задания скобкой — «1)», «6)*»
const PAREN_RE = /^[ \t]*(\d{1,2})[*°]?\)[*°]?[ \t]/gm
// Петерсон и подобные: номер вообще без знака препинания («23 Выполни…»).
// Перед номером — буква-категория задания (К/П/Д/С = классная/повторение/
// домашняя/смекалка, OCR путает с латиницей и греческой π); после номера —
// обязательно пробел и заглавная буква/формула/кавычка (иначе это дата,
// количество и т.п. посреди обычного предложения, не начало задания).
const BARE_RE = /^[ \t]*(?:([КПДСKPDCπ])[ \t]+)?(\d{1,4})[ \t]+(?=[А-ЯЁ$«(])/gm

// Учебники с теорией внутри параграфа (Бутузов и подобные): «§ N. …» →
// «Основные понятия» (полно нумерованных ТЕЗИСОВ, не заданий: «1. Правило
// сравнения…») → «Контрольные вопросы и задания» → «Примеры решения задач»
// → «Задачи и упражнения для самостоятельной работы» (это и есть настоящие
// задания, тоже нумерованные — сквозной счёт может продолжаться через
// несколько параграфов подряд). Без разделения PLAIN_RE матчит ОБА потока
// нумерации на странице вперемешку, и LIS во второй фазе неверно выбирает
// короткую последовательность тезисов теории как «главный поток», теряя
// реальные задания как «разрывы». TASK_SECTION_HEAD_RE открывает приём
// номеров, HEADING_RE любого уровня — закрывает (следующий § или подраздел
// теории того же параграфа снова не задания).
const TASK_SECTION_HEAD_RE = /^#{0,6}[ \t]*Задачи и упражнения для самостоятельной работы/gm
const HEADING_RE = /^#{1,6}[ \t]+\S/gm

function countMatches(re, s) { re.lastIndex = 0; let n = 0; while (re.exec(s) !== null) n++; return n }
let compositeTotal = 0, bareTotal = 0, dotTotal = 0, taskSectionHeads = 0
for (const p of pages) {
  if (p.contentBlocks.length > 0) continue
  if (answersStart !== null && p.index >= answersStart) break
  compositeTotal += countMatches(COMPOSITE_RE, p.markdown)
  bareTotal += countMatches(BARE_RE, p.markdown)
  dotTotal += countMatches(PLAIN_RE, p.markdown)
  taskSectionHeads += countMatches(TASK_SECTION_HEAD_RE, p.markdown)
}
const scheme = compositeTotal >= 100 ? 'composite'
  : bareTotal >= 50 && bareTotal > dotTotal * 3 ? 'bare'
  : 'plain'
// Учебник с теорией внутри параграфа (см. комментарий у TASK_SECTION_HEAD_RE
// выше) — >=10 вхождений заголовка секции задач считаем структурным
// признаком книги, не случайным совпадением текста. Только для plain-схемы:
// у composite/bare/дидактики номера уже разбиты на потоки другими
// механизмами, здесь фильтр не нужен и может неверно молчать про
// «Дополнительные задачи»/«Упражнения» без этого конкретного заголовка.
const hasTaskSections = scheme === 'plain' && taskSectionHeads >= 10
// Регэксп извлечения задания для схем 'plain'/'bare' (единый на все места
// использования, чтобы не разъезжались детектор и последующая пересборка)
const SEQ_RE = scheme === 'bare' ? BARE_RE : PLAIN_RE

const inRepetition = (idx) =>
  scheme === 'composite' && repetitionSection?.pageStart != null &&
  idx >= repetitionSection.pageStart && idx <= (repetitionSection.pageEnd ?? -1)

// Composite-книга может содержать и другие root-разделы со сквозной plain-
// нумерацией помимо «Итогового повторения» — например, вводные «Задачи на
// повторение» перед основным текстом (Мордкович 9кл ч.2, скан 4-11: «1.»,
// «8.», «16.»… без параграфа). Раньше такой раздел просто не парсился вовсе
// (COMPOSITE_RE не находит в нём совпадений, а plain-поток не заводился) —
// задания целиком пропадали. Детектируем по содержимому: root-секция без
// детей, где PLAIN_RE даёт заметно больше совпадений, чем COMPOSITE_RE —
// заводим свой поток 'plain@{sectionId}', как для «Итогового повторения»,
// но без подразделов (весь раздел — одна плоская нумерация 1..N).
const isExcludedRootSection = (s) =>
  s === repetitionSection || s === answersSection ||
  /домашн[а-яё]*\s+контрольн|оглавлени|содержани|приложени|предисловие|предметный указатель|справочный материал|повышенной трудности/i.test(s.title)
// Дидактические сборники тоже могут содержать разделы со сквозной plain-
// нумерацией ВНЕ work-структуры (Макарычев «Дидактические материалы»:
// «Итоговый тест», «Итоговое повторение по темам» — 5 тематических leaf-
// секций внутри, «Задания для школьных олимпиад» — 2 leaf-секции) — их
// work/variant-конечный автомат не обрабатывает вовсе (там нет С-N/К-N),
// поэтому нужен тот же механизм, что и для «Задачи на повторение» у
// Мордковича, только без ограничения на composite-схему и на "без детей":
// здесь допускаем leaf-секции С РОДИТЕЛЕМ (сам родитель тогда не берём,
// его дети возьмут его страницы на себя).
const standalonePlainSections = (scheme === 'composite' || isDidactic)
  ? flatSections.filter(s => {
      if (s.children.length > 0 || s.pageStart === null || isExcludedRootSection(s)) return false
      if (answersStart !== null && s.pageStart >= answersStart) return false // раздел ответов и всё после него — не задания
      // содержит С-N/К-N — уже обработано конечным автоматом work/variant
      if (isDidactic && didacticWorks.some(w => w.page >= s.pageStart && w.page <= (s.pageEnd ?? s.pageStart))) return false
      let plainN = 0, compositeN = 0
      for (let idx = s.pageStart; idx <= (s.pageEnd ?? s.pageStart); idx++) {
        const p = pages[idx]
        if (!p || p.contentBlocks.length > 0) continue
        plainN += countMatches(PLAIN_RE, p.markdown)
        compositeN += countMatches(COMPOSITE_RE, p.markdown)
      }
      return plainN >= 3 && plainN > compositeN * 2
    })
  : []
standalonePlainSections.forEach((s, i) => { s.standaloneNo = i + 1 })
if (process.env.DEBUG_STANDALONE) console.error('standalone:', standalonePlainSections.map(s => `${s.title} [${s.pageStart}-${s.pageEnd}]`))
const standalonePlainByPage = new Map()
for (const s of standalonePlainSections) {
  for (let idx = s.pageStart; idx <= (s.pageEnd ?? s.pageStart); idx++) standalonePlainByPage.set(idx, s)
}

// «Домашние контрольные работы»: задания извлекаются как отдельные атомы
// с уникальным номером «к<ДКР>.<вариант>.<номер>» (в тексте книги — «3.»,
// нумерация в каждом варианте начинается заново)
const dkrSections = scheme === 'composite'
  ? flatSections.filter(s => /домашн[а-яё]*\s+контрольн/i.test(s.title) && s.pageStart !== null)
  : []
dkrSections.forEach((s, i) => {
  s.dkrNo = parseInt(s.title.match(/№\s*(\d+)/)?.[1] ?? String(i + 1))
  s.dkrVariant = 1
  s.dkrLastNum = 0
})
const dkrByPage = new Map()
for (const s of dkrSections) {
  for (let i = s.pageStart; i <= (s.pageEnd ?? s.pageStart); i++) dkrByPage.set(i, s)
}
const DKR_HEAD_RE = /ДОМ[А-ЯЁ]+\s+КОНТРОЛЬН[А-ЯЁ]*\s+РАБОТ/i
// «Вариант 1» и его OCR-искажения: Бармант, Вармонят, Бермант, Варимят,
// Bapuanm, Bapuann, Bapuuanm (латинская "B" вместо кириллической «В»)…
const VARIANT_RE = /^#{0,6}\s*[БВB][а-яёa-z]{4,9}\s+(\d)\s*\.?\s*$/gim
// «Задание N (0,5 балла)» — номер задания словом, а не голой «N.» (Кирик
// «Физика 8 кл., Разноуровневые работы», контрольные работы на весь урок,
// см. project_books_module: PLAIN_RE/PAREN_RE не матчат этот формат вовсе —
// раздел контрольных работ выпадал из базы полностью). Скобка с баллами
// опциональна и не участвует в номере.
const TASK_LABEL_RE = /^#{0,6}[ \t]*Задание[ \t]+(\d{1,2})[ \t]*(\([^\n)]{0,20}\))?[ \t]*$/gim

// Дидактика: «Вариант N» из печатного оглавления с диапазоном страниц —
// зона со своей сквозной нумерацией (Чесноков: каждый вариант = полный
// комплект заданий 1..~350)
const variantZoneByPage = new Map()
if (isDidactic) {
  for (const s of flatSections) {
    if (!/^вариант\s*\d+$/i.test(s.title) || s.pageStart === null) continue
    if (((s.pageEnd ?? s.pageStart) - s.pageStart) < 3) continue // короткие — не зоны
    const v = parseInt(s.title.match(/(\d+)/)[1])
    for (let i = s.pageStart; i <= s.pageEnd; i++) variantZoneByPage.set(i, v)
  }
}
const didacticWorksByPage = new Map()
for (const w of didacticWorks) {
  const arr = didacticWorksByPage.get(w.page) ?? []
  arr.push(w)
  didacticWorksByPage.set(w.page, arr)
}

// ── Склейка разрывных заданий на уровне страниц (до извлечения) ──────────────
// Задание, начавшееся внизу страницы N и продолжающееся вверху страницы N+1,
// собираем в ОДНУ страницу: хвост (начало N+1 до первого нового задания/
// заголовка) переносим в конец N. Делается ДО фаз 1–3, поэтому атом извлекается
// целиком на странице N с корректными якорями, а в читалке рамка задания не
// рвётся на развороте.
//
// Отличить продолжение задания от начала теории пункта (у неё не всегда есть
// «#»-заголовок): маркеры теории/примера в хвосте → это не хвост; сильный
// признак продолжения — подпункт «в)», оборванное слово (строчная), формула,
// цифра; заглавный длинный абзац без признака — тоже теория.
const THEORY_START = /^(Определени|Теорем|Лемм|Следстви|Пример|Правил|Свойств|Доказательств|Решени|Замечани|Обозначим|Итак|В этой глав|В этом параграф|В предыдущ)/i
const THEORY_ANYWHERE = /(^|[\s.,;(»])(Пример|Приведём|Приведем|Определени|Теорем|Действительно|Вообще|Доказательств|Замечани|Обозначим|Следовательно|Свойств)/
// подпункт «в)», «г)» в начале — продолжение перечня задания, тянем всегда
const SUBPOINT_START = /^[а-еa-zё6ΓB]\)/
// прочий признак продолжения: строчная буква, формула, цифра, скобка
const CONT_START = /^([а-яё]|\$|\d|\(|\\)/
let continuationsPulled = 0

// регэксп извлечения задания для страницы idx (composite вне спец-зон, иначе SEQ)
function taskReFor(idx) {
  return scheme === 'composite' && !(isDidactic || inRepetition(idx) || dkrByPage.has(idx))
    ? COMPOSITE_RE : SEQ_RE
}

// «Вопросы для повторения к главе…» — контрольные вопросы с собственным
// рестартом нумерации 1..N (не задания книги вовсе, намеренно не
// извлекаются — см. project_books_module). BARE_RE/PLAIN_RE всё равно их
// матчит по формату, и LIS корректно отбраковывает как "вне
// последовательности", но заваливает вывод бесполезными warning'ами (до
// 18+ на страницу). Вырезаем диапазон от заголовка до следующего
// "#"-заголовка/конца страницы ДО матчинга — заменяем пробелами той же
// длины, чтобы не сдвинуть смещения (at) остальных совпадений на странице.
const QUESTIONS_HEAD_RE = /^#{0,6}[ \t]*Вопросы\s+для\s+повторения(\s+к\s+главе[^\n]*)?[ \t]*$/gim
const ANY_HEADING_RE = /^#{1,6}[ \t]+/m
// Блок вопросов регулярно переходит через границу страницы БЕЗ повторения
// заголовка (см. Атанасян: вопросы 1-18 на стр.26, 19-26 продолжают их на
// стр.27 без "####", затем настоящий заголовок "Дополнительные задачи") —
// поэтому маска считается ПОСЛЕДОВАТЕЛЬНО по всем страницам с состоянием
// insideQuestions, переживающим переход, а не независимо на каждой странице.
// ВАЖНО: маскируем только ОТДЕЛЬНУЮ копию для целей сканирования номеров
// заданий, не пишем обратно в p.markdown — та же страница идёт как есть
// (с вопросами) в book_pages для читалки, стирать их оттуда нельзя.
const scanMd = new Map()
{
  let insideQuestions = false
  for (const p of pages) {
    let md = p.markdown
    let searchFrom = 0
    if (insideQuestions) {
      const headingAt = md.search(ANY_HEADING_RE)
      const end = headingAt >= 0 ? headingAt : md.length
      md = ' '.repeat(end) + md.slice(end)
      insideQuestions = headingAt < 0
      searchFrom = end
    }
    QUESTIONS_HEAD_RE.lastIndex = searchFrom
    let m
    while ((m = QUESTIONS_HEAD_RE.exec(md)) !== null) {
      const rest = md.slice(m.index + m[0].length)
      const nextHeading = rest.search(ANY_HEADING_RE)
      const end = nextHeading >= 0 ? m.index + m[0].length + nextHeading : md.length
      md = md.slice(0, m.index) + ' '.repeat(end - m.index) + md.slice(end)
      insideQuestions = nextHeading < 0
      QUESTIONS_HEAD_RE.lastIndex = end
    }
    scanMd.set(p.index, md)
  }
}

// Дидактика: составные задания нумеруют СВОИ внутренние подпункты/варианты
// ответа тем же стилем «N.», что и сами задания варианта — styleLock (см.
// фазу 1 ниже) их не отличает, если стиль совпадает, они читаются как начало
// НОВОГО варианта (рестарт «num<=2 после lastNum>=3») и рвут счётчик на
// середине книги. Два стабильных паттерна такого рода у Генденштейна:
//  - «Дайте краткие ответы на вопросы задачи.»/«Приведите полное решение
//    задачи.» → подпункты 1./2./3*./4*. до «Расчёты:»/«Решение:»;
//  - «Установите соответствие … Ответ впишите в таблицу.» → варианты
//    сопоставления 1./2./3.… до открывающего тега готовой <table>.
// Маскируем оба в scanMd (та же техника, что QUESTIONS_HEAD_RE выше) — от
// маркерной фразы до маркера конца, конец может быть на следующей странице
// (insideMask переживает переход между страницами, тот же приём, что
// insideQuestions). Основной текст (не scanMd) не трогаем — остаётся
// читаемым в book_pages.
if (isDidactic) {
  // Окно ожидания "end" в начале следующей страницы при переносе маски через
  // границу — БЕЗ окна insideMask ищет конец по ВСЕЙ следующей странице и
  // рискует поймать одноимённый маркер уже СЛЕДУЮЩЕГО (чужого) задания —
  // тогда весь текст между ними стирается вместе с его собственным номером.
  // Окно у каждого паттерна своё, по типичному расстоянию до настоящего
  // конца: бланк «Ответы: N.___» редко длиннее ~150 симв.; а таблица
  // соответствия идёт СРАЗУ после «...таблицу.» без содержательного текста
  // между ними — здесь окно короче, иначе ловится таблица уже следующего
  // (не составного) задания, которая тоже нередко идёт где-то поблизости.
  const maskPatterns = [
    {
      start: /Дайте краткие ответы на вопросы задачи\.|Приведите полное решение задачи\./g,
      end: /[РрPp][ае][сc][чq][её][тm]ы?\s*:|[РрPp]ешение\s*:/,
      carryWindow: 250,
    },
    {
      // Таблица-ответ печатается не сразу за вопросом — она уходит в КОНЕЦ
      // страницы/группы заданий, после ещё 1-2 последующих заданий (см.
      // живой случай: «5. Установите соответствие...» → варианты А-Г →
      // «6*.»/«7*.» текст ЦЕЛИКОМ → только потом <table> для задания 5).
      // Значит "до ближайшей <table" маскирует и чужие задания между ними.
      // Правильная граница — конец САМОГО списка вариантов сопоставления
      // (Г./Γ. — последняя буква кириллического перечисления А/Б/В/Г,
      // всегда 4 строки в этой книге, каждая "БУКВА. текст. цифра.")
      // — маскируем только это перечисление, не идём до <table> вовсе.
      //
      // ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ (не устранено, решили остановиться —
      // см. project_books_module): когда буквенный список А-Г и числовой
      // список вариантов сопоставления 1-5 печатаются РАЗДЕЛЬНО (не на
      // одной строке "А. Текст. 1. Значение.", а отдельными блоками — см.
      // Генденштейн «Физика 8», стр.5/16 сборника), эта граница отсекает
      // слишком рано и оставляет числовой список немаскированным — тот
      // читается как рестарт нумерации и рвёт счётчик варианта. Попытка
      // расширить границу до "буква + опциональный числовой хвост, до
      // ближайшего <table если по дороге нет чужого N*." неоднократно
      // проверялась (2026-09-19) и каждый раз чинила часть случаев ценой
      // регресса в других местах (число распознанных заданий падало с 157
      // до 144-146 вместо роста) — итоговая цепочка причин у этого формата
      // не единая на всю книгу, чинить точечно рискованно без более
      // крупного рефакторинга самого маскирующего прохода.
      start: /Установите соответствие[\s\S]{0,150}?[Тт]аблицу\.?\s*/g,
      end: /[ГГΓ]\.\s*[^\n]*\n/,
      carryWindow: 200,
    },
  ]
  for (const { start, end, carryWindow } of maskPatterns) {
    const matchEnd = typeof end === 'function' ? end : (text) => text.match(end)
    let insideMask = false
    for (const p of pages) {
      let md = scanMd.get(p.index)
      let searchFrom = 0
      if (insideMask) {
        const window = md.slice(0, carryWindow)
        const endM = matchEnd(window)
        const at = endM ? endM.index + endM[0].length : 0 // не нашли в окне → не переносим, закрываем без стирания
        if (at > 0) md = ' '.repeat(at) + md.slice(at)
        insideMask = false
        searchFrom = at
      }
      let m
      start.lastIndex = searchFrom
      while ((m = start.exec(md)) !== null) {
        const rest = md.slice(m.index)
        const endM = matchEnd(rest)
        const at = endM ? m.index + endM.index + endM[0].length : md.length
        md = md.slice(0, m.index) + ' '.repeat(at - m.index) + md.slice(at)
        insideMask = !endM
        start.lastIndex = at
      }
      scanMd.set(p.index, md)
    }
  }

  // «Расчёты:»/«Решение:» — конец рабочего поля, но следом (та же страница
  // или следующая) идёт бланк «Ответы:/Omeem: 1. ___  2*. ___» с прочерками
  // под каждый подпункт — тоже часть шаблона задания, не текст следующего.
  // Отдельный проход, БЕЗ переноса состояния через границу страницы (в
  // отличие от maskPatterns выше): бланк либо сразу за своим «Расчёты:»/
  // «Решение:» на той же странице, либо ровно в НАЧАЛЕ следующей —
  // сквозной end-поиск по всему следующему тексту (как у maskPatterns)
  // однажды поймал чужое «Решение:» ГЛУБЖЕ в этой же странице (уже от
  // следующего составного задания) и стёр текст между ними целиком.
  // Бланк-паттерн сам по себе (без обязательного «Расчёты:»/«Решение:»
  // перед ним) — на второй странице разрыва он идёт первым, оторванный от
  // своего «Расчёты:»/«Решение:», которое осталось в хвосте предыдущей.
  const ANSWER_BLANK_ONLY_RE = /(?:[ОоOo][тm][a-яa-z]*\s*:)?(?:\s*\d{1,2}\*?\.\s*_+\s*){1,4}/g
  for (const p of pages) {
    let md = scanMd.get(p.index)
    // Бланк сразу после «Расчёты:»/«Решение:» на ЭТОЙ ЖЕ странице — ищем
    // локально в пределах короткого окна после каждого вхождения, не
    // сквозным match() по всему остатку страницы (тот однажды поймал
    // «Решение:» уже следующего задания и стёр всё до него).
    const endRe = /[РрPp][ае][сc][чq][её][тm]ы?\s*:|[РрPp]ешение\s*:/g
    let em
    while ((em = endRe.exec(md)) !== null) {
      const windowStart = em.index + em[0].length
      const window = md.slice(windowStart, windowStart + 200)
      ANSWER_BLANK_ONLY_RE.lastIndex = 0
      const bm = ANSWER_BLANK_ONLY_RE.exec(window)
      if (bm && bm.index <= 3) {
        md = md.slice(0, windowStart) + ' '.repeat(bm[0].length) + md.slice(windowStart + bm[0].length)
      }
      endRe.lastIndex = windowStart
    }
    scanMd.set(p.index, md)
  }
  // Бланк, оторванный переносом страницы (нет «Расчёты:»/«Решение:» перед
  // ним на ЭТОЙ странице — оно осталось в хвосте предыдущей) — маскируем в
  // самом НАЧАЛЕ страницы, если он там есть, независимо от состояния.
  for (const p of pages) {
    let md = scanMd.get(p.index)
    ANSWER_BLANK_ONLY_RE.lastIndex = 0
    const bm = ANSWER_BLANK_ONLY_RE.exec(md)
    if (bm && bm.index === 0) md = ' '.repeat(bm[0].length) + md.slice(bm[0].length)
    scanMd.set(p.index, md)
  }
}

// Дидактические сборники не трогаем: задания короткие (разрывов почти нет),
// а перенос текста сбил бы конечный автомат работ/вариантов в фазе 1.
if (!isDidactic) {
  for (let n = 0; n < pages.length - 1; n++) {
    if (pages[n].contentBlocks.length > 0) continue
    if (answersStart !== null && n >= answersStart) break
    // на странице N должно быть хотя бы одно задание — иначе хвосту не к чему цепляться
    const reN = taskReFor(n); reN.lastIndex = 0
    if (!reN.test(scanMd.get(n))) continue
    // ближайшая содержательная следующая страница (пропускаем пустые/колонцифры)
    let j = n + 1
    while (j < pages.length && (pages[j].markdown.trim() === '' || /^\d{1,4}$/.test(pages[j].markdown.trim()))) j++
    if (j >= pages.length || pages[j].contentBlocks.length > 0) continue
    if (answersStart !== null && j >= answersStart) continue

    const nextMd = pages[j].markdown
    const reNext = taskReFor(j); reNext.lastIndex = 0
    const nextTask = reNext.exec(nextMd)
    const nextHeading = nextMd.search(/^#{1,6}\s/m)
    let cut = nextMd.length
    if (nextTask) cut = Math.min(cut, nextTask.index)
    if (nextHeading >= 0) cut = Math.min(cut, nextHeading)
    if (cut >= nextMd.length) continue      // нет границы задания/заголовка ниже — не тянем целую страницу (риск теории)

    const cont = nextMd.slice(0, cut).trim()
    if (!cont || /^#/.test(cont)) continue                              // страница сразу с задания/заголовка
    if (THEORY_START.test(cont) || THEORY_ANYWHERE.test(cont)) continue // теория пункта, а не хвост
    // подпункты продолжаем всегда; прочий хвост — только короткий и с явным
    // признаком продолжения (иначе это проза-теория, а не остаток задания)
    if (!SUBPOINT_START.test(cont) && !(CONT_START.test(cont) && cont.length <= 200)) continue

    // переносим хвост в конец страницы N, вырезаем его из начала страницы N+1
    pages[n].markdown = pages[n].markdown.replace(/\s+$/, '') + '\n\n' + cont
    pages[j].markdown = nextMd.slice(cut).replace(/^\s+/, '')
    continuationsPulled++
  }
}

const problems = []
let lastNum = 0            // максимальный принятый сквозной номер (plain/повторение)
let lastPara = 0, lastSub = 0  // composite-схема

// Фаза 1: сбор кандидатов по страницам. Композитные номера фильтруются
// монотонным окном сразу; сквозные (plain-схема, «Итоговое повторение»)
// откладываются — их отберёт LIS во второй фазе: длиннейшая возрастающая
// подпоследовательность сама выкидывает OCR-галлюцинации («1260. Exposure
// to…» между 1238 и 1239), дубли и рестарты «Контрольных вопросов».
const pageEntries = []
// состояние дидактического разбора: текущая работа/вариант (переживает страницы)
const didState = { work: null, variant: 1, lastNum: 0, styleLock: null }
// hasTaskSections: приём plain-номеров только внутри секции «Задачи и
// упражнения…», выключается любым следующим заголовком (переживает
// страницы — секция часто продолжается на следующей странице без заголовка).
// Нумерация НЕ сквозная по книге — сбрасывается к 1 в КАЖДОЙ секции (65 секций
// в тестовой книге, проверено эмпирически), поэтому каждой секции присваивается
// свой порядковый номер (taskSectionNo) — уникальность task_number обеспечивает
// префикс «§N.» на его основе, LIS здесь не нужен вовсе (сквозного потока нет).
let inTaskSection = false
let taskSectionNo = 0 // порядковый номер ТЕКУЩЕЙ секции (0 = вне секции)

for (const p of pages) {
  if (answersStart !== null && p.index >= answersStart) break // ответы и дальше — не задания
  if (p.contentBlocks.length > 0) continue // страницы оглавления

  // Матчим номера заданий по МАСКИРОВАННОЙ копии (вопросы для повторения
  // вырезаны пробелами той же длины — смещения "at" не сдвигаются и текст
  // задания эту маску не пересекает — маска покрывает только диапазон
  // вопросов), но entry.md — ОРИГИНАЛ p.markdown: он используется дальше
  // фазой 3 для нарезки prompt-текста атомов срезом по этим же "at"
  // (md.slice(s.at, end)) — маскированный текст испортил бы содержимое
  // задачи, если бы она физически соседствовала с диапазоном вопросов на
  // той же странице (напр. «Дополнительные задачи» сразу после вопросов).
  const scanText = scanMd.get(p.index)
  const md = p.markdown

  // ── Дидактика: события страницы (работы, варианты, кандидаты) по порядку ──
  if (isDidactic) {
    const entry = { p, md, accepted: [], plain: [] }
    const contVariant = variantZoneByPage.get(p.index) ?? null
    if (contVariant !== null) didState.work = null // вариантные зоны — вне работ
    const standaloneSection = standalonePlainByPage.get(p.index) ?? null
    if (standaloneSection) didState.work = null // «Итоговый тест»/повторение/олимпиады — вне работ

    let m
    const events = []
    for (const w of didacticWorksByPage.get(p.index) ?? []) events.push({ at: w.at, type: 'work', w: w.resolved ?? w })
    VARIANT_RE.lastIndex = 0
    while ((m = VARIANT_RE.exec(scanText)) !== null) events.push({ at: m.index, type: 'variant', v: parseInt(m[1]) })
    PLAIN_RE.lastIndex = 0
    while ((m = PLAIN_RE.exec(scanText)) !== null) events.push({ at: m.index, type: 'task', style: '.', glyph: m[1] ?? null, num: parseInt(m[2]), star: m[3] || null })
    PAREN_RE.lastIndex = 0
    while ((m = PAREN_RE.exec(scanText)) !== null) events.push({ at: m.index, type: 'task', style: ')', glyph: null, num: parseInt(m[1]), star: /[*°]/.test(m[0]) ? '*' : null })
    TASK_LABEL_RE.lastIndex = 0
    while ((m = TASK_LABEL_RE.exec(scanText)) !== null) events.push({ at: m.index, type: 'task', style: 'label', glyph: null, num: parseInt(m[1]), star: null })
    events.sort((a, b) => a.at - b.at)

    for (const ev of events) {
      if (ev.type === 'work') {
        // Смена работы (первый вход или переход от другой работы) — сброс на
        // «вариант 1» безусловный. Само число в идущем впритык 'variant'-событии
        // (если есть) обрабатывается СЛЕДУЮЩЕЙ итерацией цикла и скорректирует
        // это значение, если оно достоверно (см. ветку 'variant' ниже) —
        // насколько достоверно, зависит от того, что было раньше по at, а не
        // здесь; поэтому здесь всегда «1», без исключений.
        const isNewEntry = didState.work !== ev.w
        if (isNewEntry) { didState.variant = 1; didState.lastNum = 0 }
        ev.w.entered = true
        didState.work = ev.w
        didState.styleLock = null
      } else if (ev.type === 'variant') {
        // Число в заголовке «Вариант N» изначально бывает недостоверным (в
        // markdown.text печатается позиция внутри пары страниц, не абсолютный
        // номер) — но insertHeaderBlocksAt (см. выше, вызывается для всех
        // дидактических книг) восстанавливает СКРЫТЫЕ заголовки из PaddleOCR
        // header-блоков с ПРАВИЛЬНЫМИ номерами на КАЖДОЙ странице, поэтому
        // к моменту этой обработки в markdown уже есть верный номер — доверяем
        // ему прямо.
        didState.variant = ev.v
        didState.lastNum = 0
        didState.styleLock = null
      } else if (didState.work === null && contVariant !== null) {
        // сквозная нумерация внутри вариантной зоны → LIS-поток «в{N}»
        if (ev.style === '.') entry.plain.push({ glyph: ev.glyph, num: ev.num, at: ev.at, stream: `в${contVariant}` })
      } else if (didState.work === null && standaloneSection !== null) {
        // «Итоговый тест»/«Итоговое повторение по темам»/«Олимпиады» — root
        // или leaf-секция без work-структуры, своя сквозная нумерация 1..N
        // (см. standalonePlainSections выше), отдельный LIS-поток на секцию
        if (ev.style === '.') entry.plain.push({ glyph: ev.glyph, num: ev.num, at: ev.at, stream: `st${standaloneSection.standaloneNo}`, standaloneSection })
      } else if (didState.work) {
        const st = didState
        // стиль нумерации («1.» или «1)») фиксируется первым заданием варианта:
        // цифровые подпункты другого стиля внутри задания — не задания
        if (st.styleLock && ev.style !== st.styleLock) continue
        if (ev.num >= 1 && ev.num <= 40 && ev.num > st.lastNum && ev.num - st.lastNum <= 6) {
          st.lastNum = ev.num
        } else if (ev.num <= 2 && st.lastNum >= 3) {
          st.variant++ // рестарт нумерации без заголовка варианта
          st.lastNum = ev.num
        } else {
          warnings.push(`стр.${p.index}: пропущен номер ${ev.num} (работа ${st.work.kind}${st.work.no}, вар. ${st.variant}, последний ${st.lastNum})`)
          continue
        }
        st.styleLock = ev.style
        entry.accepted.push({
          glyph: ev.glyph,
          star: ev.star,
          at: ev.at,
          taskNumber: `${st.work.kind}${st.work.no}.${st.variant}.${st.lastNum}`,
          sort: 2_000_000 + st.work.globalIdx * 10_000 + st.variant * 1000 + st.lastNum,
        })
      }
      // кандидаты до первой работы (предисловие, планирование) — не задания
    }
    pageEntries.push(entry)
    continue
  }

  // граница ДКР-зоны на странице: на первой странице ДКР до заголовка
  // ещё идут задания параграфа (композитные)
  const dkrSec = dkrByPage.get(p.index) ?? null
  let dkrFrom = null
  if (dkrSec) {
    const hm = p.index === dkrSec.pageStart ? scanText.match(DKR_HEAD_RE) : null
    dkrFrom = p.index === dkrSec.pageStart ? (hm ? hm.index : 0) : 0
  }

  const entry = { p, md, accepted: [], plain: [] }
  const standaloneSection = standalonePlainByPage.get(p.index) ?? null
  const usePlain = scheme === 'plain' || scheme === 'bare' || inRepetition(p.index) || standaloneSection !== null
  // composite-книга вне повторения: plain-номера («П.1» в приложении) —
  // не задания основной нумерации
  const re = usePlain ? SEQ_RE : COMPOSITE_RE

  // Учебник с теорией внутри параграфа (см. TASK_SECTION_HEAD_RE выше):
  // список переходов «номер секции задач ИЛИ 0 (вне секции)» на этой
  // странице, по позиции в scanText — каждый кандидат берёт номер секции
  // последнего перехода до своей позиции. Между страницами номер секции
  // наследуется через taskSectionNo/inTaskSection (секция часто продолжается
  // на следующей странице без заголовка).
  let taskSectionTransitions = null
  const taskSectionNoAtPageStart = taskSectionNo // до обработки transitions этой страницы
  if (hasTaskSections && usePlain) {
    const positions = []
    TASK_SECTION_HEAD_RE.lastIndex = 0
    let hm
    const onPositionSet = new Set()
    while ((hm = TASK_SECTION_HEAD_RE.exec(scanText)) !== null) { positions.push({ at: hm.index, on: true }); onPositionSet.add(hm.index) }
    HEADING_RE.lastIndex = 0
    while ((hm = HEADING_RE.exec(scanText)) !== null) {
      if (!onPositionSet.has(hm.index)) positions.push({ at: hm.index, on: false })
    }
    positions.sort((a, b) => a.at - b.at)
    // Присваиваем номер секции ПО ПОРЯДКУ прохода переходов страницы —
    // taskSectionNo растёт монотонно по количеству встреченных ON-переходов
    // за всю книгу (не сбрасывается по страницам), ровно как inTaskSection.
    taskSectionTransitions = positions.map(t => ({ at: t.at, no: t.on ? ++taskSectionNo : 0 }))
  }
  function taskSectionAt(pos) {
    if (!taskSectionTransitions) return -1 // фильтр не активен для этой книги — не блокирует
    let no = inTaskSection ? taskSectionNoAtPageStart : 0
    for (const t of taskSectionTransitions) {
      if (t.at > pos) break
      no = t.no
    }
    return no
  }

  let m
  re.lastIndex = 0
  while ((m = re.exec(scanText)) !== null) {
    if (dkrFrom !== null && m.index >= dkrFrom) continue // ДКР-зона — ниже отдельно
    if (usePlain) {
      const sectionNo = taskSectionTransitions ? taskSectionAt(m.index) : -1
      if (taskSectionTransitions && sectionNo <= 0) {
        continue // теория параграфа, не задание
      }
      const rep = inRepetition(p.index)
      // «Итоговое повторение» с тематическими подразделами: у каждого своя
      // сквозная нумерация 1..N — отдельный LIS-поток 'rep{номер подраздела}'
      const subsection = rep && hasRepetitionSubsections ? repetitionSubsectionAt(p.index, m.index) : null
      // изолированный root-раздел со своей плоской нумерацией (см. выше) —
      // отдельный поток по номеру секции, не мешается со сквозной нумерацией книги
      // ts{N} — секция «Задачи и упражнения…» №N (нумерация НЕ сквозная по
      // книге, сбрасывается в каждой секции — свой LIS-поток на секцию, тот
      // же принцип, что rep{N}/st{N} выше).
      const stream = sectionNo > 0 ? `ts${sectionNo}`
        : subsection ? `rep${subsection.no}` : (rep ? 'rep' : (standaloneSection ? `st${standaloneSection.standaloneNo}` : null))
      entry.plain.push({ glyph: m[1] ?? null, num: parseInt(m[2]), star: m[3] || null, at: m.index, rep, stream, subsection, standaloneSection })
      continue
    }
    const s = { glyph: m[1] ?? null, para: parseInt(m[2]), num: parseInt(m[3]), at: m.index }
    const ok =
      (s.para === lastPara && s.num > lastSub && s.num - lastSub <= 40) ||
      (s.para > lastPara && s.para - lastPara <= 3 && s.num >= 1 && s.num <= 40)
    if (!ok) {
      warnings.push(`стр.${p.index}: пропущен номер ${s.para}.${s.num} (вне последовательности, последний ${lastPara}.${lastSub})`)
      continue
    }
    lastPara = s.para
    lastSub = s.num
    s.taskNumber = `${s.para}.${s.num}`
    s.sort = s.para * 1000 + s.num
    entry.accepted.push(s)
  }

  // ДКР-зона: локальная нумерация 1..N в каждом варианте
  if (dkrSec) {
    const variants = []
    VARIANT_RE.lastIndex = 0
    while ((m = VARIANT_RE.exec(scanText)) !== null) variants.push({ at: m.index, v: parseInt(m[1]) })
    PLAIN_RE.lastIndex = 0
    while ((m = PLAIN_RE.exec(scanText)) !== null) {
      if (m.index < dkrFrom) continue
      const num = parseInt(m[2])
      const vh = variants.filter(v => v.at < m.index).pop()
      if (vh && vh.v !== dkrSec.dkrVariant) {
        dkrSec.dkrVariant = vh.v
        dkrSec.dkrLastNum = 0
      } else if (!vh && num <= 2 && dkrSec.dkrLastNum >= 4) {
        // заголовок варианта потерян OCR — рестарт нумерации выдаёт его
        dkrSec.dkrVariant++
        dkrSec.dkrLastNum = 0
      }
      if (num <= dkrSec.dkrLastNum || num > dkrSec.dkrLastNum + 6 || num > 15) {
        warnings.push(`стр.${p.index}: пропущен номер ДКР${dkrSec.dkrNo} ${num} (вариант ${dkrSec.dkrVariant}, последний ${dkrSec.dkrLastNum})`)
        continue
      }
      dkrSec.dkrLastNum = num
      entry.accepted.push({
        glyph: m[1] ?? null,
        at: m.index,
        taskNumber: `к${dkrSec.dkrNo}.${dkrSec.dkrVariant}.${num}`,
        sort: 2_000_000 + dkrSec.dkrNo * 10_000 + dkrSec.dkrVariant * 1000 + num,
      })
    }
  }
  // Перенести состояние «внутри секции задач» на следующую страницу — по
  // ПОСЛЕДНЕМУ переходу на этой (секция часто продолжается без заголовка).
  if (taskSectionTransitions && taskSectionTransitions.length > 0) {
    inTaskSection = taskSectionTransitions[taskSectionTransitions.length - 1].no > 0
  }
  pageEntries.push(entry)
}

// Фаза 2: LIS-отбор сквозных номеров. Потоки независимы: основной поток
// книги, «Итоговое повторение», вариантные зоны дидактики («в1», «в2»…)
const streams = new Map()
for (const e of pageEntries) {
  for (const c of e.plain) {
    const key = c.stream ?? (c.rep ? 'rep' : 'main')
    if (!streams.has(key)) streams.set(key, [])
    streams.get(key).push({ e, c })
  }
}
for (const [key, stream] of streams) {
  const kept = new Set(
    longestIncreasingByNum(stream.map((x, i) => ({ num: x.c.num, idx: i }))).map(k => k.idx)
  )
  stream.forEach((x, i) => {
    if (!kept.has(i)) {
      warnings.push(`стр.${x.e.p.index}: пропущен номер ${x.c.num} (вне возрастающей последовательности${key.startsWith('в') ? `, ${key}` : ''})`)
      return
    }
    if (key.startsWith('в')) {
      const v = parseInt(key.slice(1))
      x.c.taskNumber = `в${v}.${x.c.num}`
      x.c.sort = 10_000_000 + v * 100_000 + x.c.num
    } else if (key.startsWith('rep') && key !== 'rep') {
      // тематический подраздел «Итогового повторения» — своя нумерация 1..N,
      // уникальность номера по книге обеспечивает префикс «п{номер подраздела}.»
      const n = parseInt(key.slice(3))
      x.c.taskNumber = `п${n}.${x.c.num}`
      x.c.sort = 3_000_000 + n * 100_000 + x.c.num
    } else if (key.startsWith('st')) {
      // изолированный root-раздел со своей плоской нумерацией (см. standalonePlainSections)
      const n = parseInt(key.slice(2))
      x.c.taskNumber = `нр${n}.${x.c.num}`
      x.c.sort = 4_000_000 + n * 100_000 + x.c.num
    } else if (key.startsWith('ts')) {
      // секция «Задачи и упражнения для самостоятельной работы» №N — своя
      // нумерация 1..N в КАЖДОЙ секции (не сквозная по книге, см.
      // TASK_SECTION_HEAD_RE) — уникальность по книге даёт префикс «§N.»
      const n = parseInt(key.slice(2))
      x.c.taskNumber = `§${n}.${x.c.num}`
      x.c.sort = 5_000_000 + n * 100_000 + x.c.num
    } else {
      x.c.taskNumber = String(x.c.num)
      x.c.sort = key === 'rep' ? 1_000_000 + x.c.num : x.c.num
      lastNum = Math.max(lastNum, x.c.num)
    }
    x.e.accepted.push(x.c)
  })
}

// Внутристраничная OCR-разметка иногда вырезает служебные глифы (номер
// соседнего пункта в рамке, буллиты) как отдельные <img> — в координатах
// bounding box из имени файла (img_in_image_box_X1_Y1_X2_Y2) они физически
// крошечные (замерено ~40-60px), в отличие от настоящих иллюстраций/чертежей
// (сотни px). Порог подобран по выборке — не идеален (редкая мелкая, но
// настоящая картинка теоретически тоже может попасть под него), после
// импорта стоит выборочно сверять задания, которые остались без ответа.
const DECORATIVE_IMG_MAX_PX = 70

function stripDecorativeImages(text) {
  return text.replace(
    /<div style="text-align: center;"><img src="([^"]*)" alt="Image" width="\d+%" \/><\/div>\n*/g,
    (whole, src) => {
      const m = src.match(/img_in_image_box_(\d+)_(\d+)_(\d+)_(\d+)/)
      if (!m) return whole // не смогли определить размер по имени файла — оставляем как есть
      const [x1, y1, x2, y2] = m.slice(1).map(Number)
      const w = x2 - x1, h = y2 - y1
      return (w < DECORATIVE_IMG_MAX_PX && h < DECORATIVE_IMG_MAX_PX) ? '' : whole
    }
  )
}

// Фаза 3: тексты заданий
for (const e of pageEntries) {
  const { p, md, accepted } = e
  accepted.sort((a, b) => a.at - b.at)

  for (let i = 0; i < accepted.length; i++) {
    const s = accepted[i]
    let end = i + 1 < accepted.length ? accepted[i + 1].at : md.length
    // Учебник с теорией внутри параграфа (hasTaskSections, см.
    // TASK_SECTION_HEAD_RE выше): ПОСЛЕДНЕЕ принятое задание секции на
    // странице не имеет следующего accepted-соседа на ЭТОЙ ЖЕ странице —
    // end падал на md.length, захватывая всё до конца страницы, включая
    // заголовок следующего параграфа ("### § N+1. …"), его теорию
    // ("Основные понятия", "Контрольные вопросы и задания", "Примеры
    // решения задач") — то есть страницы текста теории склеивались в
    // prompt_md последней задачи предыдущего параграфа (живой инцидент:
    // «Математический анализ в вопросах и задачах», §12.14 — 2206 символов
    // вместо обычных ~150, с полным текстом теоремы о непрерывности сложной
    // функции внутри условия). Заголовок параграфа надёжно обозначает конец
    // задания — TASK_SECTION_HEAD_RE сам является таким заголовком
    // (открывающим секцию), поэтому детектор запуска секции задач уже
    // отфильтровал бы её содержимое от НОВЫХ заданий, но не подрезает
    // ХВОСТ предыдущего. Обрезаем срез по ближайшему заголовку внутри
    // текущего диапазона [s.at, end), если он там есть.
    if (hasTaskSections) {
      const window = md.slice(s.at, end)
      ANY_HEADING_RE.lastIndex = 0
      const headingRel = window.slice(1).search(ANY_HEADING_RE) // slice(1): не матчить сам якорь s.at
      if (headingRel >= 0) end = s.at + 1 + headingRel
    }
    // хвост разрывного задания уже перенесён в конец этой страницы пред-проходом
    // joinSplitTasks (до фазы 1), поэтому здесь просто режем по якорям
    const prompt = stripDecorativeImages(md.slice(s.at, end).trim())

    problems.push({
      taskNumber: s.taskNumber,
      taskNumberSort: s.sort,
      pageIndex: p.index,
      mdStart: s.at,
      mdEnd: end,
      promptMd: prompt,
      hasImages: /<img\s/.test(prompt),
      forcedSection: s.subsection?.section ?? s.standaloneSection ?? null,
      difficulty:
        // ∞/⑤ — общий маркер; С/C — «задачи на смекалку» (Петерсон)
        (s.glyph && /[∞⑤СC]/.test(s.glyph)) || s.star || isInAdvancedRange(p.index, s.at)
          ? 'advanced' : 'standard',
    })
  }
}

// Книга группирует задания под общей инструкцией («Решите неравенство:»,
// «Разложите на множители:», «Найдите область определения выражения $f(x)$:»
// — короткая формула-переменная внутри тоже встречается, поэтому "$" внутри
// строки не запрещаем) — обычно инструкция открывает страницу/группу отдельной
// строкой ПЕРЕД номером следующего задания, но иногда OCR (или сама вёрстка)
// кладёт её строкой ПОСЛЕ предыдущего задания на той же странице — тогда она
// попадает в конец prompt_md чужого атома, а начало следующего лишается
// контекста. Переносим такую «висячую» инструкцию в начало следующего задания
// (проверено на 44 случаях по всей книге): последняя строка атома — начинается
// с русской заглавной буквы (реальная инструкция — короткая императивная
// фраза-заголовок, не продолжение условия и не подпункт) и оканчивается на «:».
const TRAILING_INSTRUCTION_RE = /\n\n([А-ЯЁ][^\n]{3,150}:)\s*$/
// Заголовок параграфа (### §N. НАЗВАНИЕ) иногда попадает МЕЖДУ последним
// заданием параграфа и висячей инструкцией следующего — сам заголовок уже
// отражён в book_sections (см. TOC), поэтому в тексте задания это чистый
// шум; снимаем его, чтобы TRAILING_INSTRUCTION_RE увидел инструкцию как
// действительно последнюю строку и перенос сработал (пример: 1.26 → 2.1).
const TRAILING_PARA_HEADING_RE = /\n\n#{1,6}[ \t]+§[^\n]*\s*$/
for (let i = 0; i < problems.length - 1; i++) {
  // перенос только внутри одной страницы — иначе соседство в массиве problems
  // может быть случайным артефактом порядка LIS-потоков, а не реальным
  // соседством в тексте книги
  if (problems[i].pageIndex !== problems[i + 1].pageIndex) continue
  const m = problems[i].promptMd.match(TRAILING_INSTRUCTION_RE)
  if (m) {
    const line = m[1].trim()
    if (!/^[а-еa-z6ΓB]\)|^\d/.test(line)) { // подпункт/начало другого задания — не инструкция
      problems[i].promptMd = problems[i].promptMd.slice(0, -m[0].length).trimEnd()
      problems[i + 1].promptMd = `${line}\n\n${problems[i + 1].promptMd}`
      problems[i].hasImages = /<img\s/.test(problems[i].promptMd) // могло измениться, если картинка была после инструкции
    }
  }
  // заголовок параграфа мог остаться последней строкой уже после переноса
  // инструкции выше (порядок в тексте: …задание §N. \n #### §N+1 \n инструкция)
  problems[i].promptMd = problems[i].promptMd.replace(TRAILING_PARA_HEADING_RE, '').trimEnd()
}

// дубликаты номеров (unique constraint) — оставляем первое вхождение
const seen = new Set()
let uniqueProblems = []
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
  // тематический подраздел «Итогового повторения» известен точно по LIS-потоку —
  // не переопределяем его общей эвристикой по диапазону страниц (подразделы
  // могут делить страницу, и sectionFor() взял бы «самый поздний по pageStart»)
  pr.section = pr.forcedSection ?? sectionFor(pr.pageIndex)
  if (!pr.section) warnings.push(`задание ${pr.taskNumber} (стр.${pr.pageIndex}) не попало ни в один раздел`)
}

if (onlyGrade) {
  const before = uniqueProblems.length
  uniqueProblems = uniqueProblems.filter(pr => pr.section?.grade === onlyGrade)
  warnings.push(`--only-grade ${onlyGrade}: из ${before} заданий оставлено ${uniqueProblems.length} (остальные — другие классы, в эту книгу не попадут)`)
}

// ── Ответы ───────────────────────────────────────────────────────────────────

// Номера ответов в книге идут строго по возрастанию. Числа внутри самих
// ответов ("г) 1. ", "…г) 25. 202.") дают ложные позиции — отбрасываем их,
// оставляя наибольшую возрастающую подпоследовательность номеров.
function longestIncreasingByNum(items) {
  const n = items.length
  if (n === 0) return []
  const dp = new Array(n).fill(1)
  const prev = new Array(n).fill(-1)
  let best = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (items[j].num < items[i].num && dp[j] + 1 > dp[i]) { dp[i] = dp[j] + 1; prev[i] = j }
    }
    if (dp[i] > dp[best]) best = i
  }
  const out = []
  for (let i = best; i >= 0; i = prev[i]) { out.push(items[i]); if (prev[i] === -1) break }
  return out.reverse()
}

// OCR местами превращает строки ответов в display-math с \mathbf-обёртками:
// "$$ \mathbf{31.19.a})\:-\mathbf{2};… $$" → распутываем в обычный текст
function normalizeAnswersOcr(text) {
  let t = text
  for (let i = 0; i < 5; i++) {
    const before = t
    t = t.replace(/\\(?:mathbf|mathrm|mathtt|mathit|boldsymbol|operatorname|text)\s*\{([^{}]*)\}/g, '$1')
    if (t === before) break
  }
  return t
    .replace(/\$\$/g, ' ')
    .replace(/\\[:;,!]|\\quad|\\qquad|\\ /g, ' ')
    .replace(/\\S\b/g, '§')
    .replace(/_\{\s*\}/g, '')
}

// Назначение найденного ответа заданию + эвристика метода автопроверки
const byTaskNumber = new Map(uniqueProblems.map(pr => [pr.taskNumber, pr]))
let answersFound = 0
function assignAnswer(taskNumber, rawAnswer) {
  const answer = chainNormalizeMarkers(rawAnswer.trim().replace(/\s+/g, ' '))
  const pr = byTaskNumber.get(taskNumber)
  if (!pr || pr.correctAnswer || !answer || answer.length > 800) return
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

// Дидактические сборники, где эталон печатается не текстом «8.1. …», а
// HTML-таблицей «строка = вариант, столбцы = подпункты задания» — формат
// PaddleOCR для книг Генденштейна и, вероятно, не только (см.
// project_books_module, 2026-09-19): заголовок таблицы — colspan-группы
// «Задание N» с подпунктами построчно под каждой ("1","2","3*","4*"), тело —
// первая ячейка строки = номер варианта, остальные = ответ на этот подпункт.
// Перед каждой таблицей — заголовок работы «Контрольная работа № N» (или
// иное совпадение с WORK_RE/KR_HEAD_RE — переиспользуем didacticWorks,
// сопоставленных по номеру, не по эксземпляру, т.к. заголовок в разделе
// «Ответы» — это НЕ то же вхождение, что заголовок самой работы в тексте
// заданий, у него нет своего didacticWorks-элемента).
function parseDidacticAnswerTables(text) {
  const workHeaderRe = /Контрольная работа\s*№\s*(\d+)/gi
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi
  const rowRe = /<tr>([\s\S]*?)<\/tr>/gi
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi

  // Индекс "at заголовка работы" → номер работы, для сопоставления с ближайшей
  // ПРЕДШЕСТВУЮЩЕЙ таблицей (заголовок печатается прямо перед своей таблицей).
  const workHeaders = []
  let wm
  while ((wm = workHeaderRe.exec(text)) !== null) workHeaders.push({ at: wm.index, no: parseInt(wm[1]) })

  const stripHtml = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\$\s*\^\{\{?\*\}?\}\s*\$/g, '*').replace(/\s+/g, ' ').trim()

  let tm
  while ((tm = tableRe.exec(text)) !== null) {
    const tableAt = tm.index
    const work = [...workHeaders].reverse().find(w => w.at <= tableAt)
    if (!work) continue

    const rows = []
    let rm
    rowRe.lastIndex = 0
    while ((rm = rowRe.exec(tm[1])) !== null) {
      const cells = []
      let cm
      cellRe.lastIndex = 0
      while ((cm = cellRe.exec(rm[1])) !== null) cells.push(stripHtml(cm[1]))
      rows.push(cells)
    }
    if (rows.length < 3) continue // заголовок(1-2 строки) + минимум 1 строка данных

    // Строка 0: rowspan-заголовок («Номер варианта») + colspan-группы
    // («Задание 8» ×4, «Задание 9» ×2) — рассчитываем span из исходного HTML
    // (regex, не DOM: колво <td> в строке 0 меньше физического кол-ва
    // столбцов, colspan восполняет разницу).
    const headerRowHtml = (() => {
      rowRe.lastIndex = 0
      const first = rowRe.exec(tm[1])
      return first ? first[1] : ''
    })()
    const headerCellsRaw = [...headerRowHtml.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)]
    const taskGroups = [] // [{taskNum, span}]
    for (const [, attrs, content] of headerCellsRaw) {
      const label = stripHtml(content)
      const m2 = label.match(/Задание\s*(\d+)/i)
      if (!m2) continue // первая ячейка «Номер варианта» (rowspan, не задание)
      const span = parseInt(attrs.match(/colspan="?(\d+)"?/)?.[1] ?? '1')
      taskGroups.push({ taskNum: m2[1], span })
    }
    if (taskGroups.length === 0) continue

    // Строка 1: подпункты по столбцам ("1","2","3*","4*","1","2*") — плоский
    // список длины = сумма span, режем по границам taskGroups.
    const subLabels = rows[1]
    const groupedLabels = []
    let cursor = 0
    for (const g of taskGroups) {
      groupedLabels.push({ taskNum: g.taskNum, labels: subLabels.slice(cursor, cursor + g.span) })
      cursor += g.span
    }

    // Строки данных (rows[2..]): первая ячейка — номер варианта, остальные
    // выровнены с groupedLabels по тому же порядку столбцов. Собираем текст
    // в уже поддерживаемом формате меток "N) значение" (см. LABEL_RE в
    // scripts/lib/multi-part-answer.mjs — метка это ровно 1-2 цифры/буква,
    // без "*"), а не отдельный {parts:} — так assignAnswer/composite-разбор
    // при копировании в тест срабатывают без доработки где-либо ещё.
    for (const row of rows.slice(2)) {
      const variantNo = parseInt(row[0])
      if (!Number.isFinite(variantNo)) continue
      let col = 1
      for (const g of groupedLabels) {
        const piecesText = []
        for (const label of g.labels) {
          const raw = (row[col] ?? '').trim()
          const bareLabel = label.replace(/\s+/g, '').replace(/\*$/, '')
          if (raw && bareLabel) piecesText.push(`${bareLabel}) ${raw}`)
          col++
        }
        if (piecesText.length > 0) {
          assignAnswer(`р${work.no}.${variantNo}.${g.taskNum}`, piecesText.join('; '))
        }
      }
    }
  }
}

// Второй формат HTML-таблиц ответов у дидактических сборников (Громцева
// «Контрольные и самостоятельные работы по физике» — см. project_books_module,
// 2026-09-19): в отличие от parseDidacticAnswerTables (там строка=вариант,
// colspan-группы=задание+подпункты), здесь строка=ВАРИАНТ, простой столбец
// (без colspan) = НОМЕР ЗАДАНИЯ; ответы не составные (без "N) значение").
// Якорь перед таблицей — заголовок работы, двух видов:
//  - «СР-N. Тема» / «CP-N. Тема» (кириллица/латиница вперемешку из-за OCR,
//    см. SHORT_WORK_HEAD_RE) — номер работы берём прямо из N;
//  - «Контрольная работа»/«Контрольная работа «Тема»» БЕЗ номера — как и в
//    основном парсере (didacticWorks: printedNo=null для этой формы), номер
//    назначается порядковым счётчиком по появлению, 1-based.
function parseGromtsevaAnswerTables(text) {
  const srHeaderRe = /[СC][РP][ \t]*[-–—.][ \t]*(\d+)/g
  const krHeaderRe = /Контрольная работа/gi
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi
  const rowRe = /<tr>([\s\S]*?)<\/tr>/gi
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi
  const stripHtml = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  const headers = []
  let m
  while ((m = srHeaderRe.exec(text)) !== null) headers.push({ at: m.index, kind: 'с', no: parseInt(m[1]) })
  let krIdx = 0
  while ((m = krHeaderRe.exec(text)) !== null) { krIdx++; headers.push({ at: m.index, kind: 'р', no: krIdx }) }
  headers.sort((a, b) => a.at - b.at)

  let tm
  while ((tm = tableRe.exec(text)) !== null) {
    const tableAt = tm.index
    const work = [...headers].reverse().find(h => h.at <= tableAt)
    if (!work) continue

    const rows = []
    let rm
    rowRe.lastIndex = 0
    while ((rm = rowRe.exec(tm[1])) !== null) {
      const cells = []
      let cm
      cellRe.lastIndex = 0
      while ((cm = cellRe.exec(rm[1])) !== null) cells.push(stripHtml(cm[1]))
      rows.push(cells)
    }
    if (rows.length < 2) continue // заголовок + минимум 1 строка данных

    // Строка 0: первая ячейка — надпись угла («№ задания / № варианта»),
    // остальные — номера заданий по порядку столбцов.
    const taskNumbers = rows[0].slice(1)
    for (const row of rows.slice(1)) {
      const variantNo = parseInt(row[0])
      if (!Number.isFinite(variantNo)) continue
      for (let col = 0; col < taskNumbers.length; col++) {
        const taskNo = parseInt(taskNumbers[col])
        const raw = (row[col + 1] ?? '').trim()
        if (!Number.isFinite(taskNo) || !raw) continue
        assignAnswer(`${work.kind}${work.no}.${variantNo}.${taskNo}`, raw)
      }
    }
  }
}

// Парсинг блока ответов: candidates → LIS (номера в книге строго возрастают,
// ложные позиции из чисел внутри самих ответов отсеиваются) → назначение.
// taskNumberPrefix — для тематических подразделов «Итогового повторения»
// («п{N}.»), где у книги своя нумерация нескольких заданий «1.», «2.»…
function parseAnswersBlock(text, mode, taskNumberPrefix = '') {
  const rawPositions = []
  let am
  if (mode === 'composite') {
    // "1.6. a) 35" / "31,22, a)" (запятые от OCR) / "3.33.353 квартиры" (потерян пробел)
    const numRe = /(?<=^|[\s;().,])(\d{1,2})[.,](\d{1,3})[.,]/g
    while ((am = numRe.exec(text)) !== null) {
      const para = parseInt(am[1]), sub = parseInt(am[2])
      if (para < 1 || sub < 1) continue
      rawPositions.push({
        num: para * 1000 + sub, taskNumber: `${para}.${sub}`,
        at: am.index, contentAt: am.index + am[0].length,
      })
    }
  } else {
    // после точки допускаем цифру: OCR теряет пробел («120.0,187»)
    const numRe = /(?<=^|[\s;])(\d{1,4})\.(?=\s|\d)/g
    while ((am = numRe.exec(text)) !== null) {
      rawPositions.push({
        num: parseInt(am[1]), taskNumber: taskNumberPrefix + am[1],
        at: am.index, contentAt: am.index + am[0].length,
      })
    }
  }
  const positions = longestIncreasingByNum(rawPositions)
  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i + 1].at : Math.min(text.length, positions[i].contentAt + 800)
    assignAnswer(positions[i].taskNumber, text.slice(positions[i].contentAt, end))
  }
}

if (answersStart !== null) {
  let text = pages.slice(answersStart, answersEnd + 1).map(p => p.markdown).join('\n')

  // Отрезаем ответы «Итогового повторения» (заголовок «ГЛАВА <номер повторения>»)
  // и приложения — у них собственная сквозная нумерация
  let repetitionText = null
  if (scheme === 'composite' && repetitionSection) {
    // Заголовок раздела ответов на повторение — либо «ГЛАВА <номер повторения>»
    // (когда повторение оформлено как отдельная глава), либо совпадает с
    // заголовком самого repetitionSection («ИТОГОВОЕ ПОВТОРЕНИЕ» и т.п.)
    const repHeader = new RegExp(
      `^#{1,6}\\s*(?:ГЛАВА\\s*${repetitionSection.number ?? ''}|${repetitionSection.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*$`,
      'mi',
    )
    const appHeader = /^#{1,6}\s*ПРИЛОЖЕНИЕ\s*$/mi
    const repAt = text.search(repHeader)
    const appAt = text.search(appHeader)
    if (repAt >= 0) {
      repetitionText = text.slice(repAt, appAt > repAt ? appAt : undefined)
      text = text.slice(0, repAt)
    } else if (appAt >= 0) {
      text = text.slice(0, appAt)
    }
  }

  const clean = (t) => normalizeAnswersOcr(t)
    .replace(/^#{1,6}\s.*$/gm, ' ')                 // заголовки (ОТВЕТЫ, Глава N)
    // "К параграфу 5." / "K параграфу 5." (OCR: латинская K) / "К главе 3."
    .replace(/[КK]\s+(параграфу|дополнительным упражнениям|главе)[^.]*\./gi, ' ')

  // Таблицы ответов (см. parseDidacticAnswerTables/parseGromtsevaAnswerTables)
  // — на СЫРОМ тексте, HTML-теги нужны целиком; только для дидактических
  // сборников, где встречается этот формат. Оба парсера безопасно идут друг
  // за другом: их якоря не пересекаются ("Контрольная работа № N" с номером
  // vs "СР-N"/"CP-N" и "Контрольная работа" без номера), а assignAnswer сам
  // пропускает задания, уже получившие ответ. Перед обычным
  // parseAnswersBlock — тот на HTML-тегах внутри ячеек ничего не найдёт для
  // уже назначенных taskNumber, но лучше не тратить его проходом по
  // огромному <table>-блоку, если тот уже разобран целиком.
  if (isDidactic) { parseDidacticAnswerTables(text); parseGromtsevaAnswerTables(text) }

  parseAnswersBlock(clean(text), scheme)
  if (repetitionText && hasRepetitionSubsections) {
    // Ответы на «Итоговое повторение» с тематическими подразделами размечены
    // теми же заголовками, что и сами задания (см. repetitionSubsections) —
    // делим текст ответов по этим заголовкам и парсим каждый кусок отдельно
    // со своим префиксом «п{N}.», иначе одинаковые номера "1.", "2."… из разных
    // подразделов задания схлопнутся в один LIS-поток и потеряют бОльшую часть.
    const cuts = []
    for (const sub of repetitionSubsections) {
      const re = new RegExp(`^#{1,6}[ \\t]+${sub.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'mi')
      const at = repetitionText.search(re)
      if (at >= 0) cuts.push({ no: sub.no, at })
    }
    cuts.sort((a, b) => a.at - b.at)
    for (let i = 0; i < cuts.length; i++) {
      const chunk = repetitionText.slice(cuts[i].at, i + 1 < cuts.length ? cuts[i + 1].at : undefined)
      parseAnswersBlock(clean(chunk), 'plain', `п${cuts[i].no}.`)
    }
  } else if (repetitionText) {
    parseAnswersBlock(clean(repetitionText), 'plain')
  }
}

// ── Предметный указатель ─────────────────────────────────────────────────────
// Семантическое ядро для поиска задач по теме (по решению пользователя):
// термин указателя → печатная страница → book_section_id (резолв через
// book_sections.page_start/page_end) — агент ищет тему по названию в
// book_index_terms.search_vector и получает раздел книги, где искать
// задачи, вместо полнотекстового перебора book_problems.prompt_md. См.
// миграцию 078.
//
// Как и «Ответы»/«Оглавление» у этой книги, «Предметный указатель» либо не
// выделен в TOC отдельной строкой, либо (как здесь) TOC-узел найден, но
// накрывает СРАЗУ и указатель, и следующее за ним «Оглавление» одним
// диапазоном (обе строки потеряны в печатном оглавлении OCR'ом) — границы
// находим прямым поиском заголовков в тексте, не через TOC.
function findHeadingPage(regex) {
  for (const p of pages) if (regex.test(p.markdown)) return p.index
  return null
}
const indexStart = findHeadingPage(/^#{1,6}[ \t]*Предметный\s+указатель[ \t]*$/im)
const tocPageStart = findHeadingPage(/^#{1,6}[ \t]*Оглавление[ \t]*$/im)
const indexTerms = []
if (indexStart !== null) {
  const indexEnd = (tocPageStart !== null && tocPageStart > indexStart) ? tocPageStart - 1 : pages.length - 1
  let text = pages.slice(indexStart, indexEnd + 1).map(p => p.markdown).join('\n')
  text = text
    .replace(/^#{1,6}[ \t]*Предметный\s+указатель[ \t]*$/im, ' ')
    // OCR ложно размечает некоторые словарные статьи как markdown-заголовки
    // (видимо из-за увеличенного отступа/шрифта в начале алфавитного блока
    // печатной книги) — снимаем "#", это обычные термины, не структура
    .replace(/^#{1,6}[ \t]+/gm, '')
    // водяной знак сайта-источника, вклинившийся посреди строки термина
    .replace(/Скачан?\s*с\s*vk\.com\/material\d*/gi, ' ')

  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean)
  // Склеиваем строки, разорванные переносом (термин без номера страницы в
  // конце — продолжается на следующей строке; двухколоночная вёрстка также
  // местами вклинивает МЕЖДУ половинками термина другую статью целиком —
  // это восстановить нельзя без разметки колонок, оставляем как есть,
  // не гонимся за идеалом, см. решение пользователя).
  const lines = []
  let pending = ''
  const TRAILING_PAGES_RE = /(\d{1,4}(?:\s*,\s*\d{1,4})*)\s*$/
  for (const raw of rawLines) {
    const line = pending ? `${pending} ${raw}` : raw
    if (TRAILING_PAGES_RE.test(line)) { lines.push(line); pending = '' }
    else pending = line
  }

  // Стек уровней вложенности по ведущим тире: "— нулевой 225" продолжает
  // ближайший термин с меньшим числом тире ("Вектор"), полный термин
  // собирается конкатенацией "Родитель суффикс".
  const stack = [] // {level, term}
  for (const line of lines) {
    const m = line.match(/^((?:—[,\s]*)+)?\s*(.+?)\s+(\d{1,4}(?:\s*,\s*\d{1,4})*)\s*$/)
    if (!m) continue // строка без номера страницы после склейки — не статья указателя, пропускаем
    const dashPrefix = m[1] ?? ''
    const level = (dashPrefix.match(/—/g) ?? []).length
    const rest = m[2].trim()
    const pagesStr = m[3]
    const printedPages = [...new Set(pagesStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)))]
    if (printedPages.length === 0 || !rest) continue

    while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
    const parentTerm = level > 0 && stack.length ? stack[stack.length - 1].term : ''
    // "Биссектриса треугольника 34 — угла 13" — второй термин той же
    // словарной статьи НА ТОЙ ЖЕ СТРОКЕ (— перед второй половиной, но не
    // в начале строки) — не наш случай здесь (dashPrefix матчит только
    // ведущие тире), такие внутристрочные варианты остаются частью rest
    // как есть (не идеальный, но безопасный результат — не теряем текст).
    const term = parentTerm ? `${parentTerm} ${rest}`.trim() : rest
    stack.push({ level, term })

    indexTerms.push({ term, printedPages, sortOrder: indexTerms.length })
  }
}
// Резолв printedPages[0] → book_sections по page_start/page_end (первая
// секция, чей диапазон включает эту печатную страницу) — привязка термина
// к КОНКРЕТНОМУ разделу книги, не просто к номеру страницы.
for (const it of indexTerms) {
  const scanIdx = printedToScan(it.printedPages[0])
  it.sectionRef = scanIdx !== null
    ? flatSections.find(s => s.pageStart !== null && scanIdx >= s.pageStart && scanIdx <= (s.pageEnd ?? s.pageStart))
    : undefined
}

// ── Мета ─────────────────────────────────────────────────────────────────────

const meta = {
  title: flag('title') ?? path.basename(file, '.json'),
  authors: flag('authors') ?? null,
  subject: flag('subject') ?? 'Математика',
  grade: flag('grade') ?? onlyGrade,
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
console.log(`Схема нумерации: ${scheme}${scheme === 'composite' ? ` (макс: ${lastPara}.${lastSub}${repetitionSection ? `, повторение до ${lastNum}` : ''})` : ` (макс. номер: ${lastNum})`}`)
console.log(`Заданий: ${uniqueProblems.length}`)
if (isDidactic) {
  console.log(`  работ (СР/КР/ПР): ${new Set(didacticWorks.map(w => w.resolved ?? w)).size}`)
  console.log(`  в работах: ${uniqueProblems.filter(p => /^[срп]/.test(p.taskNumber)).length}`)
  console.log(`  в вариантных зонах: ${uniqueProblems.filter(p => p.taskNumber.startsWith('в')).length}`)
}
console.log(`  из домашних контрольных: ${uniqueProblems.filter(p => p.taskNumber.startsWith('к')).length}`)
console.log(`  с ответами из книги: ${answersFound}`)
console.log(`  с автопроверкой:     ${uniqueProblems.filter(p => p.gradingMethod && p.gradingMethod !== 'manual').length}`)
console.log(`  с картинками:        ${uniqueProblems.filter(p => p.hasImages).length}`)
console.log(`  разрывных (склеено): ${continuationsPulled}`)
console.log(`  повышенной трудности: ${uniqueProblems.filter(p => p.difficulty === 'advanced').length}`)
console.log(`  без раздела:         ${uniqueProblems.filter(p => !p.section).length}`)
if (indexTerms.length > 0) {
  console.log(`Предметный указатель: ${indexTerms.length} терминов, ${indexTerms.filter(t => t.sectionRef).length} привязано к разделу`)
}
console.log(`Предупреждений: ${warnings.length}`)
for (const w of warnings.slice(0, 25)) console.log(`  ⚠ ${w}`)
if (warnings.length > 25) console.log(`  ... и ещё ${warnings.length - 25}`)
if (uniqueProblems.some(p => p.hasImages)) {
  console.log('\n⚠ Картинки задач указывают на временный bcebos URL (PaddleOCR) — он истекает.')
  console.log('  Перезаливка в Storage (bucket book-media) происходит только при прямой записи в БД (без --dry-run/--emit-sql).')
}

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
  grade: s.grade ?? null,
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
  grade: pr.section?.grade ?? null,
}))

const indexTermRows = indexTerms.map(it => ({
  book_id: bookId,
  term: it.term,
  printed_pages: it.printedPages,
  book_section_id: it.sectionRef?.id ?? null,
  sort_order: it.sortOrder,
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
  created_by: flag('created-by') ?? null,
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
    // integer[] (book_index_terms.printed_pages) — НЕ jsonb: массив целых
    // чисел, значит все элементы числа — Postgres ARRAY-литерал, не JSON
    if (Array.isArray(v) && v.every(x => typeof x === 'number')) return `ARRAY[${v.join(',')}]::integer[]`
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
  if (indexTermRows.length > 0) write('index_terms', insert('book_index_terms', indexTermRows))
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

// На этой машине сетевые запросы (Supabase и внешние URL) иногда падают
// транзиентно ("fetch failed", похоже на TLS-перехватывающий прокси —
// см. project_local_env_limits) — 1-2 повтора с паузой обычно достаточно,
// в отличие от зависаний без ответа, которые нужно ловить таймаутом отдельно.
// supabase-js не бросает исключение на сетевой сбой — он ловит его сам и
// возвращает {error}, поэтому ретраим по result.error, а не по try/catch.
async function withRetry(fn, label, attempts = 5) {
  let result
  for (let i = 1; i <= attempts; i++) {
    try {
      result = await fn()
    } catch (e) {
      result = { error: e }
    }
    if (!result?.error) return result
    if (i === attempts) return result
    console.warn(`  ${label}: попытка ${i} не удалась (${result.error.message}), повтор через ${i}с...`)
    await new Promise(r => setTimeout(r, i * 1000))
  }
  return result
}

const { createClient } = await import('@supabase/supabase-js')
const db = createClient(url, key)

console.log('\nЗапись в БД...')

// --replace: удалить прежний импорт этой же книги (каскадом уйдут разделы/страницы/задания)
if (args.includes('--replace')) {
  const { data: existing, error } = await db
    .from('books')
    .select('id, title')
    .eq('title', meta.title)
    .eq('subject', meta.subject)
  if (error) { console.error('books lookup:', error.message); process.exit(1) }
  for (const b of existing ?? []) {
    const { error: delErr } = await db.from('books').delete().eq('id', b.id)
    if (delErr) { console.error('books delete:', delErr.message); process.exit(1) }
    console.log(`Удалён прежний импорт: ${b.id}`)
  }
}

{
  const { error } = await withRetry(() => db.from('books').insert(bookRow), 'books')
  if (error) { console.error('books:', error.message); process.exit(1) }
}

// ── Заливка исходного PDF (опционально, --pdf) ──────────────────────────────
// Сжимаем через Ghostscript (scripts/compress-pdf.mjs) перед заливкой — скан-
// учебники обычно уменьшаются в 3-6x без потери читаемости текста, что важно
// на Free-плане Supabase Storage (лимит 1 ГБ, см. project_books_module).
if (pdfFile) {
  const originalSize = fs.statSync(pdfFile).size
  let uploadPath = pdfFile
  let compressedSize = originalSize

  if (!pdfNoCompress) {
    const { execFileSync } = await import('node:child_process')
    const tmpOut = path.join(path.dirname(pdfFile), `${path.basename(pdfFile, '.pdf')}.compressed.pdf`)
    console.log(`\nСжатие PDF (${(originalSize / 1024 / 1024).toFixed(1)} МБ)...`)
    try {
      execFileSync('node', [path.join(__dirname, 'compress-pdf.mjs'), pdfFile, tmpOut], { stdio: 'inherit' })
      if (fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 0 && fs.statSync(tmpOut).size < originalSize) {
        uploadPath = tmpOut
        compressedSize = fs.statSync(tmpOut).size
      } else {
        console.warn('Сжатие не дало выигрыша — заливаю оригинал.')
      }
    } catch (e) {
      console.error('Сжатие PDF не удалось (Ghostscript не найден?), заливаю оригинал без сжатия:', e.message)
    }
  }

  const storagePath = `${bookId}/original.pdf`
  const pdfBuffer = fs.readFileSync(uploadPath)
  console.log(`Загрузка PDF в book-documents/${storagePath} (${(compressedSize / 1024 / 1024).toFixed(1)} МБ)...`)
  const { error: pdfErr } = await db.storage
    .from('book-documents')
    .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: true })
  if (pdfErr) {
    console.error('book-documents upload:', pdfErr.message, '— книга сохранена без PDF, догрузите вручную.')
  } else {
    const { error: updErr } = await db.from('books').update({
      pdf_storage_path: storagePath,
      pdf_size_bytes: compressedSize,
      pdf_original_size_bytes: originalSize,
    }).eq('id', bookId)
    if (updErr) console.error('books update (pdf path):', updErr.message)
    else console.log('PDF привязан к книге.')
  }
  if (uploadPath !== pdfFile) fs.unlinkSync(uploadPath) // временный сжатый файл больше не нужен
}

// Задания заливаются ДО перезаливки картинок (см. ниже): картинки — best-effort
// шаг по медленной/нестабильной внешней сети, задания не должны от него зависеть.
//
// Батчи по 20/40 (не 100/200, как раньше) — на этой машине большие payload'ы
// к Supabase систематически рвутся ("fetch failed", TLS-перехват), пока
// поменьше проходят надёжно (см. project_local_env_limits). book_sections
// раньше вставлялась ОДНИМ batch'ем целиком — при книге с глубокой
// структурой (Атанасян: 196 секций вместо обычных 40-60) это тоже стало
// рваться систематически (3/3 попыток withRetry, не спорадически) — теперь
// батчится так же, по 40. self-referencing FK (parent_id) безопасен: строки
// идут в document order (walk() — pre-order DFS, родитель раньше детей в
// массиве), а батчи пишутся последовательно (await), так что родитель уже
// физически в БД к моменту вставки батча с его детьми.
// Пауза МЕЖДУ каждым батчем (не только между таблицами) — по наблюдению
// пользователя, длинный сплошной поток мелких запросов подряд (у этой
// книги: 196 секций + 417 страниц + 1340 заданий + 300 терминов, все
// батчами по 5-20) сам по себе поднимает нагрузку на нестабильный
// TLS-перехватывающий прокси этой машины и рвёт соединение — не размер
// отдельного payload, а плотность запросов в единицу времени.
const PAUSE_MS = 400
async function insertBatched(table, rows, batchSize) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const { error } = await withRetry(() => db.from(table).insert(rows.slice(i, i + batchSize)), `${table}@${i}`)
    // "fetch failed" на этой машине (TLS-перехватывающий прокси) иногда
    // означает, что запрос НА САМОМ ДЕЛЕ прошёл на сервере, но ответ не
    // долетел клиенту — withRetry тогда повторяет тот же insert и natural-но
    // бьётся о unique constraint. Дублирующий ключ здесь означает «эта партия
    // уже вставлена предыдущей попыткой», не настоящую ошибку данных —
    // считаем идемпотентным успехом и продолжаем со следующего батча, вместо
    // падения всего импорта на середине (живой случай: book_pages@5 стабильно
    // рвал прогон, оставляя книгу в БД наполовину без единого задания).
    if (error && error.code !== '23505') { console.error(`${table}@${i}:`, error.message); process.exit(1) }
    if (error) console.warn(`  ${table}@${i}: уже вставлено предыдущей попыткой (duplicate key), пропускаю`)
    await new Promise(r => setTimeout(r, PAUSE_MS))
  }
}
await insertBatched('book_sections', sectionRows, 20)
// Дополнительная пауза при переключении на новую таблицу — на этой книге
// (196 секций, вместо обычных 40-60) первый запрос к book_pages
// систематически (6/6 прогонов) падал именно сразу после долгой серии
// запросов к book_sections.
await new Promise(r => setTimeout(r, 2000))
await insertBatched('book_pages', pageRows, 5)
await insertBatched('book_problems', problemRows, 20)
if (indexTermRows.length > 0) await insertBatched('book_index_terms', indexTermRows, 50)
console.log(`Готово. book_id = ${bookId}`)

// ── Перезаливка картинок задач в Storage ─────────────────────────────────────
// PaddleOCR отдаёт картинки задач ссылками на bcebos — подписанный URL с
// собственным API, который истекает (см. project_books_module: этот же
// техдолг тянется с первой книги). Скачиваем каждую уникальную картинку и
// заливаем в публичный bucket book-media, затем UPDATE'ом переписываем src
// в уже вставленных book_pages/book_problems (задания к этому моменту уже
// в БД и доступны — картинки не блокируют их появление).
//
// --images-concurrency N (по умолчанию 1): на машинах с TLS-перехватывающим
// прокси несколько параллельных HTTPS-соединений к одному внешнему хосту
// замечены зависающими навечно (даже с AbortController) — последовательная
// загрузка медленнее, но надёжна. Поднимайте только если сеть это позволяет.
if (!args.includes('--skip-images')) {
  const IMAGES_CONCURRENCY = Math.max(1, parseInt(flag('images-concurrency') ?? '1') || 1)
  const urlToStorage = new Map() // externalUrl → storageUrl
  const uniqueUrls = new Set()
  for (const p of pages) for (const u of Object.values(p.images)) uniqueUrls.add(u)

  console.log(`\nПеренос картинок в Storage (${uniqueUrls.size} уникальных, параллельно: ${IMAGES_CONCURRENCY})...`)
  let uploaded = 0, failed = 0
  const queue = [...uniqueUrls]
  async function worker() {
    while (queue.length > 0) {
      const externalUrl = queue.shift()
      try {
        // без таймаута зависший запрос вешает весь Promise.all навечно
        // (наблюдалось на практике — процесс висел без ошибки и без прогресса)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 12_000)
        let res
        try {
          res = await fetch(externalUrl, { signal: controller.signal })
        } finally {
          clearTimeout(timer)
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        // signal аборта fetch гарантирует прерывание только до получения
        // заголовков, не во время самого чтения тела — зависание наблюдалось
        // именно на этом шаге, поэтому отдельный таймаут нужен и здесь
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
        warnings.push(`картинка не перезалита (${e.message}), оставлен исходный bcebos URL: ${externalUrl.slice(0, 100)}…`)
        failed++
      }
      if ((uploaded + failed) % 10 === 0) console.log(`  ...${uploaded + failed}/${uniqueUrls.size}`)
    }
  }
  await Promise.all(Array.from({ length: IMAGES_CONCURRENCY }, worker))
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
