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
const WORK_RE = /^#{0,6}[ \t]*((?:Вводн[а-яё]+[ \t]+|Итогов[а-яё]+[ \t]+|Примерн[а-яё]+[ \t]+)?(Самостоятельн|Контрольн|Проверочн)[а-яё]*[ \t]+работа(?![а-яё])[^\n]*)/gim
// «K-1 (Виленкин, п. 7)» — заголовок КР; бывает и обычной строкой без «#»,
// поэтому требуем строку целиком: номер + необязательная скобочная пометка
const KR_HEAD_RE = /^#{0,6}[ \t]*[KК][ \t]*[-–—][ \t]*(\d+)[ \t]*(\([^\n)]{0,80}\))?[ \t]*$/gm
const KIND_BY_WORD = { 'самостоятельн': 'с', 'контрольн': 'р', 'проверочн': 'п' }

const didacticWorks = [] // {page, at, title, kind, printedNo, no, globalIdx}
if (isDidactic) {
  for (const p of pages) {
    let m
    WORK_RE.lastIndex = 0
    while ((m = WORK_RE.exec(p.markdown)) !== null) {
      const title = m[1].trim()
      didacticWorks.push({
        page: p.index, at: m.index, title,
        kind: KIND_BY_WORD[m[2].toLowerCase()] ?? 'р',
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
  }
  didacticWorks.sort((a, b) => a.page - b.page || a.at - b.at)

  // Одна работа печатает заголовок над каждым вариантом («K-1 …» ×4) —
  // повторы с тем же названием в пределах 6 страниц схлопываются в одну
  const byTitle = new Map()
  for (const w of didacticWorks) {
    const keyT = w.title.toLowerCase().replace(/\s+/g, ' ')
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

for (let i = 0; i < flatSections.length; i++) {
  const cur = flatSections[i]
  const next = flatSections.slice(i + 1).find(s => s.pageStart !== null && s.pageStart >= (cur.pageStart ?? 0))
  cur.pageEnd = next?.pageStart != null ? Math.max(cur.pageStart ?? 0, next.pageStart - (next.pageStart > (cur.pageStart ?? 0) ? 1 : 0)) : pages.length - 1
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
// Гейт по isDidactic: у уже отгруженных дидактических сборников (Кубышева,
// Чесноков) ответов нет вовсе — эвристика для них не запускается, чтобы не
// внести регресс. Для книг с явным «Ответы» в TOC эвристика не вызывается
// вовсе (короткое замыкание ??).
const answersStart = answersSection?.pageStart ?? (!isDidactic ? findHeuristicAnswersStart(pages) : null)
// конец ответов = начало следующего раздела книги (Предметный указатель,
// Справочный материал...) либо конец книги
const afterAnswersStarts = answersStart !== null
  ? flatSections.filter(s => s.pageStart !== null && s.pageStart > answersStart && s !== answersSection).map(s => s.pageStart)
  : []
const answersEnd = afterAnswersStarts.length > 0 ? Math.min(...afterAnswersStarts) - 1 : pages.length - 1
const advancedSection = flatSections.find(s => /повышенной трудности/i.test(s.title))
// «Итоговое повторение» (Мордкович): глава с собственной сквозной нумерацией 1..N
const repetitionSection = flatSections.find(s => /итогов[а-яё]*\s+повторени/i.test(s.title))

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

function countMatches(re, s) { re.lastIndex = 0; let n = 0; while (re.exec(s) !== null) n++; return n }
let compositeTotal = 0, bareTotal = 0, dotTotal = 0
for (const p of pages) {
  if (p.contentBlocks.length > 0) continue
  if (answersStart !== null && p.index >= answersStart) break
  compositeTotal += countMatches(COMPOSITE_RE, p.markdown)
  bareTotal += countMatches(BARE_RE, p.markdown)
  dotTotal += countMatches(PLAIN_RE, p.markdown)
}
const scheme = compositeTotal >= 100 ? 'composite'
  : bareTotal >= 50 && bareTotal > dotTotal * 3 ? 'bare'
  : 'plain'
// Регэксп извлечения задания для схем 'plain'/'bare' (единый на все места
// использования, чтобы не разъезжались детектор и последующая пересборка)
const SEQ_RE = scheme === 'bare' ? BARE_RE : PLAIN_RE

const inRepetition = (idx) =>
  scheme === 'composite' && repetitionSection?.pageStart != null &&
  idx >= repetitionSection.pageStart && idx <= (repetitionSection.pageEnd ?? -1)

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
// «Вариант 1» и его OCR-искажения: Бармант, Вармонят, Бермант, Варимят…
const VARIANT_RE = /^#{0,6}\s*[БВ][а-яёa-z]{4,9}\s+(\d)\s*\.?\s*$/gim

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

// Дидактические сборники не трогаем: задания короткие (разрывов почти нет),
// а перенос текста сбил бы конечный автомат работ/вариантов в фазе 1.
if (!isDidactic) {
  for (let n = 0; n < pages.length - 1; n++) {
    if (pages[n].contentBlocks.length > 0) continue
    if (answersStart !== null && n >= answersStart) break
    // на странице N должно быть хотя бы одно задание — иначе хвосту не к чему цепляться
    const reN = taskReFor(n); reN.lastIndex = 0
    if (!reN.test(pages[n].markdown)) continue
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

for (const p of pages) {
  if (answersStart !== null && p.index >= answersStart) break // ответы и дальше — не задания
  if (p.contentBlocks.length > 0) continue // страницы оглавления

  const md = p.markdown

  // ── Дидактика: события страницы (работы, варианты, кандидаты) по порядку ──
  if (isDidactic) {
    const entry = { p, md, accepted: [], plain: [] }
    const contVariant = variantZoneByPage.get(p.index) ?? null
    if (contVariant !== null) didState.work = null // вариантные зоны — вне работ

    let m
    const events = []
    for (const w of didacticWorksByPage.get(p.index) ?? []) events.push({ at: w.at, type: 'work', w: w.resolved ?? w })
    VARIANT_RE.lastIndex = 0
    while ((m = VARIANT_RE.exec(md)) !== null) events.push({ at: m.index, type: 'variant', v: parseInt(m[1]) })
    PLAIN_RE.lastIndex = 0
    while ((m = PLAIN_RE.exec(md)) !== null) events.push({ at: m.index, type: 'task', style: '.', glyph: m[1] ?? null, num: parseInt(m[2]), star: m[3] || null })
    PAREN_RE.lastIndex = 0
    while ((m = PAREN_RE.exec(md)) !== null) events.push({ at: m.index, type: 'task', style: ')', glyph: null, num: parseInt(m[1]), star: /[*°]/.test(m[0]) ? '*' : null })
    events.sort((a, b) => a.at - b.at)

    for (const ev of events) {
      if (ev.type === 'work') {
        // повторный заголовок той же работы (над каждым вариантом) не сбрасывает
        // счётчики; возврат к работе после чередования — сбрасывает номер
        if (!ev.w.entered) { ev.w.entered = true; didState.variant = 1; didState.lastNum = 0 }
        else if (didState.work !== ev.w) didState.lastNum = 0
        didState.work = ev.w
        didState.styleLock = null
      } else if (ev.type === 'variant') {
        didState.variant = ev.v
        didState.lastNum = 0
        didState.styleLock = null
      } else if (didState.work === null && contVariant !== null) {
        // сквозная нумерация внутри вариантной зоны → LIS-поток «в{N}»
        if (ev.style === '.') entry.plain.push({ glyph: ev.glyph, num: ev.num, at: ev.at, stream: `в${contVariant}` })
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
    const hm = p.index === dkrSec.pageStart ? md.match(DKR_HEAD_RE) : null
    dkrFrom = p.index === dkrSec.pageStart ? (hm ? hm.index : 0) : 0
  }

  const entry = { p, md, accepted: [], plain: [] }
  const usePlain = scheme === 'plain' || scheme === 'bare' || inRepetition(p.index)
  // composite-книга вне повторения: plain-номера («П.1» в приложении) —
  // не задания основной нумерации
  const re = usePlain ? SEQ_RE : COMPOSITE_RE

  let m
  re.lastIndex = 0
  while ((m = re.exec(md)) !== null) {
    if (dkrFrom !== null && m.index >= dkrFrom) continue // ДКР-зона — ниже отдельно
    if (usePlain) {
      entry.plain.push({ glyph: m[1] ?? null, num: parseInt(m[2]), star: m[3] || null, at: m.index, rep: inRepetition(p.index) })
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
    while ((m = VARIANT_RE.exec(md)) !== null) variants.push({ at: m.index, v: parseInt(m[1]) })
    PLAIN_RE.lastIndex = 0
    while ((m = PLAIN_RE.exec(md)) !== null) {
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
    } else {
      x.c.taskNumber = String(x.c.num)
      x.c.sort = key === 'rep' ? 1_000_000 + x.c.num : x.c.num
      lastNum = Math.max(lastNum, x.c.num)
    }
    x.e.accepted.push(x.c)
  })
}

// Фаза 3: тексты заданий
for (const e of pageEntries) {
  const { p, md, accepted } = e
  accepted.sort((a, b) => a.at - b.at)

  for (let i = 0; i < accepted.length; i++) {
    const s = accepted[i]
    const end = i + 1 < accepted.length ? accepted[i + 1].at : md.length
    // хвост разрывного задания уже перенесён в конец этой страницы пред-проходом
    // joinSplitTasks (до фазы 1), поэтому здесь просто режем по якорям
    const prompt = md.slice(s.at, end).trim()

    problems.push({
      taskNumber: s.taskNumber,
      taskNumberSort: s.sort,
      pageIndex: p.index,
      mdStart: s.at,
      mdEnd: end,
      promptMd: prompt,
      hasImages: /<img\s/.test(prompt),
      difficulty:
        // ∞/⑤ — общий маркер; С/C — «задачи на смекалку» (Петерсон)
        (s.glyph && /[∞⑤СC]/.test(s.glyph)) || s.star ||
        (advancedSection && advancedSection.pageStart !== null &&
          p.index >= advancedSection.pageStart && p.index <= (advancedSection.pageEnd ?? -1))
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

// Номера ответов в книге идут строго по возрастанию. Числа внутри самих
// ответов ("г) 1. ", "…г) 25. 202.") дают ложные позиции — отбрасываем их,
// оставляя наибольшую возрастающую подпоследовательность номеров.
function longestIncreasingByNum(items) {
  const n = items.length
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

// Парсинг блока ответов: candidates → LIS (номера в книге строго возрастают,
// ложные позиции из чисел внутри самих ответов отсеиваются) → назначение
function parseAnswersBlock(text, mode) {
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
        num: parseInt(am[1]), taskNumber: am[1],
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
    const repHeader = new RegExp(`^#{1,6}\\s*ГЛАВА\\s*${repetitionSection.number ?? ''}\\s*$`, 'mi')
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

  parseAnswersBlock(clean(text), scheme)
  if (repetitionText) parseAnswersBlock(clean(repetitionText), 'plain')
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
