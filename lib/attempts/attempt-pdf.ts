import type { PDFFont, PDFPage, RGB } from 'pdf-lib'
import { latexToPlain } from '@/lib/tasks/prompt'
import { wrapBareLatex } from '@/lib/grading/format-answer-display'

// PDF-сводка попытки для проверки на бумаге или в мессенджере: шапка (ученик,
// работа, итог) и таблица «№ · ответ ученика · правильный ответ · балл».
// Условия заданий не выводятся — это лист сверки ответов, а не копия работы.
//
// Собирается в браузере из данных, уже загруженных в окне «Попытка студента»
// (AttemptDrawer): нового серверного доступа к ответам нет, права те же.
// pdf-lib и шрифт грузятся только по клику (динамический import + fetch).
// Шрифт — Liberation Sans (OFL, public/fonts): стандартные шрифты PDF не
// умеют кириллицу. Формулы выводятся текстом: «$\frac{1}{2}$» → «1/2».

export interface AttemptPdfRow {
  number: number | string
  studentAnswer: string
  correctAnswer: string | null
  score: number | null
  maxScore: number | null
  isCorrect: boolean | null
  /** Балл засчитан в одной из прошлых попыток */
  locked: boolean
  /** Сколько фото письменного решения приложил ученик */
  photos: number
  comment: string | null
}

export interface AttemptPdfInput {
  studentName: string
  grade: string | null
  testTitle: string
  statusLabel: string
  score: number | null
  maxScore: number | null
  submittedAt: string | null
  checkedAt: string | null
  teacherComment: string | null
  rows: AttemptPdfRow[]
}

export interface AttemptPdfFonts { regular: ArrayBuffer; bold: ArrayBuffer }

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 36
const FOOTER_H = 16
const PAD = 4
const SIZE = 10
const SMALL = 8.5
const LINE = 12.5
const SMALL_LINE = 10.5
const MAX_CELL_LINES = 40
// № | ответ ученика | правильный ответ | балл — в сумме ширина контента
const COLS = [28, 214, 214, 67.28]

// Символы, которых нет в шрифте, — читаемой заменой вместо пустого квадрата
const GLYPH_FALLBACK: Record<string, string> = {
  '∈': ' из ', '∉': ' не из ', 'ℝ': 'R', 'ℕ': 'N', 'ℤ': 'Z', 'ℚ': 'Q', 'ℂ': 'C', '∛': '³√', '✓': 'v',
}

let fontsPromise: Promise<AttemptPdfFonts> | null = null
function loadFonts(): Promise<AttemptPdfFonts> {
  const get = (name: string) => fetch(`/fonts/${name}`).then((r) => {
    if (!r.ok) throw new Error(`Шрифт ${name} не загрузился`)
    return r.arrayBuffer()
  })
  fontsPromise ??= Promise.all([get('LiberationSans-Regular.ttf'), get('LiberationSans-Bold.ttf')])
    .then(([regular, bold]) => ({ regular, bold }))
    .catch((e) => { fontsPromise = null; throw e })
  return fontsPromise
}

const paren = (s: string) => (s.trim().length > 1 && /[+\-−\s]/.test(s.trim()) ? `(${s.trim()})` : s.trim())

// Ответ с LaTeX → строка для PDF. Сначала то, чего не умеет latexToPlain
// (дроби, степени, \text), затем она сама: символы и снятие разметки.
export function answerToPlain(s: string): string {
  let t = wrapBareLatex(s)
  for (let i = 0; i < 3; i++) {
    t = t.replace(/\\[dtc]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a: string, b: string) => `${paren(a)}/${paren(b)}`)
  }
  t = t
    .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^{}]*)\}/g, '$1')
    .replace(/\^(?:\{2\}|2(?![0-9]))/g, '²')
    .replace(/\^(?:\{3\}|3(?![0-9]))/g, '³')
    .replace(/\\left|\\right/g, '')
    .replace(/\\[,;:! ]/g, ' ')
  return latexToPlain(t).replace(/[ \t]+/g, ' ').trim()
}

export function attemptPdfFileName(input: Pick<AttemptPdfInput, 'studentName' | 'testTitle'>): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  const name = `${clean(input.studentName)} — ${clean(input.testTitle)}`.slice(0, 120).trim()
  return `${name || 'Попытка'}.pdf`
}

export async function buildAttemptPdf(input: AttemptPdfInput, fonts?: AttemptPdfFonts): Promise<Uint8Array> {
  const [{ PDFDocument, rgb }, { default: fontkit }, fontBytes] = await Promise.all([
    import('pdf-lib'),
    import('@pdf-lib/fontkit'),
    fonts ? Promise.resolve(fonts) : loadFonts(),
  ])

  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const regular = await doc.embedFont(fontBytes.regular, { subset: true })
  const bold = await doc.embedFont(fontBytes.bold, { subset: true })
  doc.setTitle(`${input.studentName} — ${input.testTitle}`)
  doc.setCreator('mcko-app')

  const supported = new Set(regular.getCharacterSet())
  const safe = (s: string) => [...s.replace(/\r/g, '')]
    .map((ch) => (ch === '\n' || supported.has(ch.codePointAt(0)!) ? ch : GLYPH_FALLBACK[ch] ?? '?'))
    .join('')

  const C = {
    text: rgb(0.1, 0.1, 0.12),
    muted: rgb(0.42, 0.42, 0.46),
    border: rgb(0.78, 0.78, 0.8),
    head: rgb(0.93, 0.93, 0.95),
    okBg: rgb(0.92, 0.97, 0.92),
    badBg: rgb(1, 0.93, 0.93),
    ok: rgb(0.13, 0.55, 0.25),
    bad: rgb(0.8, 0.15, 0.15),
  }

  // Перенос по словам; слово шире колонки режется по символам
  const wrap = (text: string, font: PDFFont, size: number, width: number): string[] => {
    const out: string[] = []
    for (const para of safe(text).split('\n')) {
      let line = ''
      for (const word of para.split(/ +/)) {
        const cand = line ? `${line} ${word}` : word
        if (font.widthOfTextAtSize(cand, size) <= width) { line = cand; continue }
        if (line) out.push(line)
        line = ''
        let rest = word
        while (font.widthOfTextAtSize(rest, size) > width) {
          let n = rest.length - 1
          while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--
          out.push(rest.slice(0, n))
          rest = rest.slice(n)
        }
        line = rest
      }
      out.push(line)
    }
    return out
  }

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN
  const contentW = PAGE_W - 2 * MARGIN
  const bottom = MARGIN + FOOTER_H

  const text = (s: string, x: number, yy: number, opts: { font?: PDFFont; size?: number; color?: RGB } = {}) =>
    page.drawText(s, { x, y: yy, font: opts.font ?? regular, size: opts.size ?? SIZE, color: opts.color ?? C.text })

  const paragraph = (s: string, opts: { font?: PDFFont; size?: number; color?: RGB; gap?: number } = {}) => {
    const size = opts.size ?? SIZE
    const font = opts.font ?? regular
    for (const l of wrap(s, font, size, contentW)) {
      if (y - size * 1.25 < bottom) { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN }
      y -= size * 1.25
      text(l, MARGIN, y, { font, size, color: opts.color })
    }
    y -= opts.gap ?? 0
  }

  // ── Шапка ──
  paragraph(input.studentName + (input.grade ? `, ${input.grade} класс` : ''), { font: bold, size: 14, gap: 2 })
  paragraph(input.testTitle, { size: 10.5, gap: 4 })
  const pct = input.score !== null && input.maxScore ? ` (${Math.round((input.score / input.maxScore) * 100)}%)` : ''
  const summary = [
    input.score !== null ? `Итог: ${input.score} / ${input.maxScore ?? '?'}${pct}` : 'Итог: —',
    input.statusLabel,
    input.submittedAt && `Сдана: ${input.submittedAt}`,
    input.checkedAt && `Проверена: ${input.checkedAt}`,
  ].filter(Boolean).join('   ·   ')
  paragraph(summary, { size: 9.5, color: C.muted, gap: 10 })

  // ── Таблица ──
  const colX = COLS.map((_, i) => MARGIN + COLS.slice(0, i).reduce((a, b) => a + b, 0))

  const drawHeader = () => {
    const h = SIZE + 2 * PAD + 3
    page.drawRectangle({ x: MARGIN, y: y - h, width: contentW, height: h, color: C.head, borderColor: C.border, borderWidth: 0.5 })
    ;['№', 'Ответ ученика', 'Правильный ответ', 'Балл'].forEach((label, i) =>
      text(label, colX[i] + PAD, y - PAD - SIZE * 0.85 - 1, { font: bold, size: 9 }))
    for (let i = 1; i < COLS.length; i++) page.drawLine({ start: { x: colX[i], y }, end: { x: colX[i], y: y - h }, thickness: 0.5, color: C.border })
    y -= h
  }

  const cap = (lines: string[]) => (lines.length > MAX_CELL_LINES ? [...lines.slice(0, MAX_CELL_LINES - 1), '…'] : lines)

  drawHeader()
  for (const r of input.rows) {
    const inner = (i: number) => COLS[i] - 2 * PAD
    const student = cap(wrap(answerToPlain(r.studentAnswer) || '—', regular, SIZE, inner(1)))
    const notes = cap([
      ...(r.photos > 0 ? [`фото решения: ${r.photos}`] : []),
      ...(r.comment ? wrap(`Комментарий: ${answerToPlain(r.comment)}`, regular, SMALL, inner(1)) : []),
    ])
    const correct = cap(wrap(r.correctAnswer ? answerToPlain(r.correctAnswer) : '—', bold, SIZE, inner(2)))
    const scoreNote = r.locked ? ['засчитано', 'ранее'] : []

    const h = 2 * PAD + Math.max(
      student.length * LINE + notes.length * SMALL_LINE,
      correct.length * LINE,
      LINE + scoreNote.length * SMALL_LINE,
    )
    if (y - h < bottom) {
      page = doc.addPage([PAGE_W, PAGE_H])
      y = PAGE_H - MARGIN
      drawHeader()
    }

    const bg = r.isCorrect === true ? C.okBg : r.isCorrect === false ? C.badBg : undefined
    page.drawRectangle({ x: MARGIN, y: y - h, width: contentW, height: h, color: bg, borderColor: C.border, borderWidth: 0.5 })
    for (let i = 1; i < COLS.length; i++) page.drawLine({ start: { x: colX[i], y }, end: { x: colX[i], y: y - h }, thickness: 0.5, color: C.border })

    const first = y - PAD - SIZE * 0.85
    text(String(r.number), colX[0] + PAD, first, { font: bold })
    student.forEach((l, i) => text(l, colX[1] + PAD, first - i * LINE))
    notes.forEach((l, i) => text(l, colX[1] + PAD, first - student.length * LINE - i * SMALL_LINE + 1, { size: SMALL, color: C.muted }))
    correct.forEach((l, i) => text(l, colX[2] + PAD, first - i * LINE, { font: bold, color: C.ok }))

    const scoreText = `${r.score ?? '—'}/${r.maxScore ?? '?'}`
    text(scoreText, colX[3] + PAD, first, { font: bold })
    // отметка рисуется линиями: галочки и крестика нет в шрифте, а цвет
    // фона строки при чёрно-белой печати пропадает
    const mx = colX[3] + PAD + bold.widthOfTextAtSize(scoreText, SIZE) + 6
    const my = first + 3.5
    if (r.isCorrect === true) {
      page.drawLine({ start: { x: mx, y: my }, end: { x: mx + 3, y: my - 3.5 }, thickness: 1.4, color: C.ok })
      page.drawLine({ start: { x: mx + 3, y: my - 3.5 }, end: { x: mx + 9, y: my + 4 }, thickness: 1.4, color: C.ok })
    } else if (r.isCorrect === false) {
      page.drawLine({ start: { x: mx, y: my - 3.5 }, end: { x: mx + 7, y: my + 3.5 }, thickness: 1.4, color: C.bad })
      page.drawLine({ start: { x: mx, y: my + 3.5 }, end: { x: mx + 7, y: my - 3.5 }, thickness: 1.4, color: C.bad })
    }
    scoreNote.forEach((l, i) => text(l, colX[3] + PAD, first - LINE - i * SMALL_LINE + 1, { size: SMALL, color: C.muted }))

    y -= h
  }

  if (input.teacherComment?.trim()) {
    y -= 8
    paragraph(`Комментарий учителя: ${answerToPlain(input.teacherComment)}`, { size: 9.5 })
  }

  // ── Колонтитул: ученик и номер страницы ──
  const pages = doc.getPages()
  pages.forEach((p, i) => {
    const label = safe(`${input.studentName} · стр. ${i + 1} из ${pages.length}`)
    p.drawText(label, { x: MARGIN, y: MARGIN - 4, size: 7.5, font: regular, color: C.muted })
  })

  return doc.save()
}

// Скачивание файла: blob-ссылка и программный клик по <a download>
export function downloadPdf(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
