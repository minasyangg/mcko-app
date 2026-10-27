// Универсальный алгоритм парсинга PaddleOCR-JSON — используется, когда для
// типа экзамена нет своего модуля (см. index.ts), и для документов без
// указанного типа ("иной документ"). Разбивает страницы по номерам заданий
// (# N.), ищет "Ответ:"/"Решение." — рассчитан на текстовые задачники/тесты
// со сквозной нумерацией, без специфичной для конкретного экзамена вёрстки.
//
// Сводная таблица ответов в конце документа ("Ключ" — формат "РЕШУ ОГЭ"/
// "РЕШУ ЕГЭ", 2026-09-15): страница с заголовком "Ключ" и HTML-таблицей
// колонок "№ п/п" (порядковый номер в варианте) / "№ задания" (внутренний
// код банка сайта-источника — совпадает с числом после "№" в заголовке
// каждого задания "## 1. Тип 1 № 408219") / "Ответ". Раньше такого случая
// не было — единственным источником ответа был текст "Ответ:" внутри самой
// задачи, что часто давало сбой (см. findAnswerKey ниже): если
// PaddleOCR путал порядок блоков, "Ответ:" мог физически оказаться внутри
// текста следующего задания, и весь остаток попадал в его conditionParts.
// Когда сводная таблица найдена — она единственный источник ответов (по
// решению пользователя): "Ответ:" внутри текста заданий больше НЕ ищем
// вовсе, чтобы условие никогда не приняли за ответ. Привязка по коду банка
// (не по порядковому номеру) — устойчивее, если распознавание задания
// собьёт порядок.
//
// Что ещё ломало вариант ОГЭ по физике «РЕШУ ОГЭ» (2026-10-20) и как
// обходится здесь:
// - заголовок задания вверху страницы PaddleOCR размечает как колонтитул
//   (header) — задание 18 целиком приклеилось к 17. Header с заголовком
//   вида «18. Тип 18 № 2373» считаем заголовком задания;
// - утверждения «выберите два верных» пришли блоками vision_footnote и
//   пропадали — внутри задания это обычный текст;
// - двузначный код банка («№ 97») не находился — код ищем после «№»/в
//   подчёркивании, а не только как число из 3+ цифр;
// - хвост таблицы «Ключ» распознан сплошным текстом («191216 5 M/c.20485
//   1 A.») — недостающие ответы достаём из этого текста по кодам банка;
// - подзаголовки столбцов («ФИЗИЧЕСКИЕ ВЕЛИЧИНЫ») и заголовок текста к
//   заданию («Масс-спектрограф») — paragraph_title без номера, раньше
//   выбрасывались; теперь это строка условия;
// - строки, перенесённые по слогам, PaddleOCR отдаёт отдельными блоками —
//   склеиваем продолжение с предыдущей строкой;
// - буквы А/Б/В/Г в заданиях на соответствие приходят латиницей и греческими
//   (A, B, β, Γ) — по позиции заменяем на русские.
//
// Вариант ЕГЭ по физике «РЕШУ ЕГЭ» (2026-10-27): рисунок-таблицу
// (фрагмент таблицы Менделеева в задании 16) PaddleOCR распознал таблицей с
// буквальными «\n» в ячейках и водяным знаком сайта «решуегэ.рф» в
// последней ячейке — переносы чинит fixCellLineBreaks, знак вырезаем.
import { cleanParsedAnswer, detectGradingMethodInContext, normalizeAnswerForMethod, requiresExplanation } from '@/lib/grading/answer-heuristics'
import { fixCellLineBreaks } from '@/lib/ocr/table-cells'
import type { JsonTaskRaw, ParsedExamDocument, ParseWarning, PaddlePage } from './types'
import type { PaddleBlock } from './types'

const SKIP = new Set(['header', 'footer', 'number', 'header_image', 'footer_image'])

// Заголовок задания «РЕШУ ОГЭ/ЕГЭ»: «18. Тип 18 № 2373». OCR путает
// кириллицу с латиницей — «Tun 3 No», поэтому «Тип» допускаем и латиницей.
const SDAMGIA_TASK_TITLE = /^#*\s*\d{1,3}\.\s*[ТT][иu][пn]\s*\d+/

// Водяной знак «решуегэ.рф»/«решуогэ.рф» с рисунков сайта (вместе с
// переносом перед ним); е/о OCR читает и латиницей
const SDAMGIA_WATERMARK_RE = /(?:\\n|<br>|\s)*решу[еeоo]гэ\.рф/gi

const isKeyTitle = (content: string) => /^Ключ\s*$/i.test(content.replace(/^#+\s*/, '').trim())

// Извлекает код банка задач из заголовка "## 1. Тип 1 № 408219". OCR
// искажает "№" множеством способов в реальных файлах ("No", "Ne", "Nо" —
// латиница/кириллица вперемешку) и часто оборачивает число в
// "$ \underline{\text{408219}} $". Сначала — число в подчёркивании или сразу
// после знака номера (код бывает и двузначным: «№ 97»), иначе — ПОСЛЕДНЕЕ
// число длиной 3-10 цифр во всём заголовке (короче — номер задания
// "1."/"Тип 1" не даёт ложных срабатываний).
function extractBankCode(title: string): string | null {
  const underlined = title.match(/\\underline\{\s*(?:\\text\{\s*)?(\d{1,10})/)
  if (underlined) return underlined[1]
  const afterSign = title.match(/(?:№|N[oeо°º])\s*\$?\s*(\d{1,10})/)
  if (afterSign) return afterSign[1]
  const matches = [...title.matchAll(/\d{3,10}/g)]
  return matches.length > 0 ? matches[matches.length - 1][0] : null
}

// Разбирает HTML-таблицу "Ключ" (border=1, <tr><td>…) в Map<bankCode, answer>.
// Первая строка — заголовок ("№ п/п"/"№ задания"/"Ответ"), пропускаем. Без
// такой шапки это не ключ: таблица в условии (психрометрическая — числа
// во втором столбце) иначе сошла бы за ключ, и задание потеряло бы всё
// после неё. Любого из трёх признаков достаточно — OCR может исказить один.
function parseAnswerKeyTable(html: string): Map<string, string> {
  const out = new Map<string, string>()
  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
  if (rows.length === 0 || !/Ответ|задани|п\/п/i.test(rows[0][1])) return out
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c =>
      c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
    )
    if (cells.length < 3) continue
    const [, bankCode, answer] = cells
    if (/^\d{1,10}$/.test(bankCode) && answer) out.set(bankCode, answer)
  }
  return out
}

// Ищет по всем страницам таблицу "Ключ" — заголовок с текстом "Ключ"
// (header/paragraph_title/text), за которым (на той же или следующей
// значимой позиции) идёт table-блок с ожидаемыми тремя колонками. tail —
// текст после таблицы: PaddleOCR иногда распознаёт последние строки ключа
// не таблицей, а сплошным текстом (см. recoverKeyRows).
function findAnswerKey(pages: PaddlePage[]): { map: Map<string, string>; tail: string } | null {
  for (let p = 0; p < pages.length; p++) {
    const blocks = pages[p].prunedResult.parsing_res_list
    for (let i = 0; i < blocks.length; i++) {
      if (!isKeyTitle(blocks[i].block_content)) continue
      const tableIdx = blocks.findIndex((x: PaddleBlock, j: number) => j > i && x.block_label === 'table')
      if (tableIdx < 0) continue
      const map = parseAnswerKeyTable(blocks[tableIdx].block_content)
      if (map.size === 0) continue
      const after = [
        ...blocks.slice(tableIdx + 1),
        ...pages.slice(p + 1).flatMap(pg => pg.prunedResult.parsing_res_list),
      ]
      const tail = after
        .filter(b => b.block_label === 'text' || b.block_label === 'vision_footnote')
        .map(b => b.block_content)
        .join(' ')
      return { map, tail }
    }
  }
  return null
}

// Строки ключа, распознанные текстом: «191216 5 M/c.20485 1 A.» — это
// «19 | 1216 | 5 м/с.» и «20 | 485 | 1 А.» без разделителей. Коды банка
// известны из заголовков заданий: ответ — текст от кода до следующего
// известного кода, без прилипшего к тому номера строки (1–2 цифры).
function recoverKeyRows(tail: string, missingCodes: string[], allCodes: string[]): Map<string, string> {
  const out = new Map<string, string>()
  const positions = (code: string) => {
    const found: number[] = []
    for (let i = tail.indexOf(code); i >= 0; i = tail.indexOf(code, i + 1)) {
      if (/\s/.test(tail[i + code.length] ?? '')) found.push(i)
    }
    return found
  }
  for (const code of missingCodes) {
    const start = positions(code)[0]
    if (start === undefined) continue
    const from = start + code.length
    let to = tail.length
    for (const other of allCodes) {
      if (other === code) continue
      const next = positions(other).find(i => i > from)
      if (next !== undefined && next < to) to = next
    }
    let end = to
    while (end > from && to - end < 2 && /\d/.test(tail[end - 1])) end--
    const answer = tail.slice(from, end).trim()
    if (answer) out.set(code, answer)
  }
  return out
}

// ─── Склейка строк и буквы заданий на соответствие ───────────────────────────

// Часть условия, к которой можно приклеить продолжение строки: обычный
// текст, а не таблица, формула, подпись или подзаголовок.
const isPlainText = (part: string) => !/^(<|\$\$|\*|>)/.test(part.trim())

// Латинские заглавные, похожие на русские строчные: «электриче-» + «CKYIO»
// (OCR так прочитал «скую»). Применяется только к слову сразу после
// переноса по слогам.
const LOOKALIKE: Record<string, string> = { A: 'а', B: 'в', C: 'с', E: 'е', H: 'н', K: 'к', M: 'м', O: 'о', P: 'р', T: 'т', X: 'х', Y: 'у', 'ю': 'ю' }
function fixLookalikeWord(text: string): string {
  return text.replace(/^[A-Z]+(?=$|[\s.,;:!?)])/, word => {
    const chars = [...word.replace(/IO/g, 'ю')]
    return chars.every(ch => LOOKALIKE[ch]) ? chars.map(ch => LOOKALIKE[ch]).join('') : word
  })
}

// Добавляет строку текста, приклеивая продолжение: перенос по слогам
// («механиче-» + «скую энергию») или строку, начатую с маленькой буквы после
// строки без знака конца предложения («…во внутреннюю» + «энергию пара»).
function appendText(parts: string[], text: string) {
  const last = parts.length - 1
  if (last >= 0 && isPlainText(parts[last])) {
    const prev = parts[last].trimEnd()
    if (/[а-яёa-z]-$/i.test(prev) && /^[A-Za-zА-Яа-яЁё]/.test(text)) {
      parts[last] = prev.slice(0, -1) + fixLookalikeWord(text)
      return
    }
    if (!/[.!?:;»"]$/.test(prev) && /^[а-яё]/.test(text)) {
      parts[last] = `${prev} ${text}`
      return
    }
  }
  parts.push(text)
}

// Русские буквы заданий на соответствие и то, как их читает OCR.
const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е']
const LETTER_LOOKALIKES: Record<string, string[]> = {
  'А': ['А', 'A', 'Α'],
  'Б': ['Б', 'B', 'β', 'Β', '6'],
  'В': ['В', 'B', 'Β', '8'],
  'Г': ['Г', 'Γ', 'r'],
  'Д': ['Д', 'D'],
  'Е': ['Е', 'E', 'Ε'],
}
const plausibleLetter = (index: number, got: string) =>
  index < LETTERS.length && LETTER_LOOKALIKES[LETTERS[index]].includes(got)

// Буква из ячейки/метки: «$ \beta $» → «β», «$ \Gamma $» → «Γ».
function letterOf(raw: string): string {
  return raw
    .replace(/\\beta/g, 'β').replace(/\\Gamma/g, 'Γ').replace(/\\Delta/g, 'Д')
    .replace(/\\(?:mathrm|text)\{([^}]*)\}/g, '$1')
    .replace(/[$\s{}]/g, '')
}

// Метки «A) …», «B) …» подряд — по позиции заменяем на А, Б, В, Г. Так же и
// подписи под рисунками «*A)*» (графики в задании на соответствие).
// Заменяем, только если прочитанная буква похожа на ожидаемую (список
// «а) б) в)» в обычном задании так не исказится) и есть признак русского
// задания на соответствие: в серии есть настоящая русская буква, буква
// повторяется («A, B, B» — так OCR читает «А, Б, В») или в задании есть
// бланк с буквами — латинские «A) B) C)» теста по английскому не трогаем.
function normalizeLetterLabels(parts: string[], hasLetterTable: boolean): string[] {
  const out = [...parts]
  const LABEL = /^(\s*\*?\s*)(\S{1,8}?)\)(?=\s|\*|$)/
  const labelOf = (part: string) => {
    const m = part.match(LABEL)
    return m ? letterOf(m[2]) : ''
  }
  let i = 0
  while (i < out.length) {
    const run: number[] = []
    while (i < out.length) {
      const letter = labelOf(out[i])
      if (letter.length !== 1 || /[0-9а-яё]/.test(letter) || !plausibleLetter(run.length, letter)) break
      run.push(i++)
    }
    if (run.length === 0) { i++; continue }
    const labels = run.map(idx => labelOf(out[idx]))
    const cyrillic = labels.some(l => /[А-ЯЁ]/.test(l))
    const repeated = new Set(labels).size < labels.length
    if (run.length >= 2 && (cyrillic || repeated || hasLetterTable)) {
      run.forEach((idx, k) => { out[idx] = out[idx].replace(LABEL, `$1${LETTERS[k]})`) })
    }
  }
  return out
}

// Шапка таблицы-бланка ответа «A | B | B» → «А | Б | В» и метки пропусков
// «_____ (A)» в тексте этого же задания.
function normalizeLetterTable(parts: string[]): string[] {
  return parts.map(part => {
    if (!part.startsWith('<table')) return part
    const firstRow = part.match(/<tr>([\s\S]*?)<\/tr>/)
    if (!firstRow) return part
    const cells = [...firstRow[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)]
    if (cells.length < 2) return part
    const letters = cells.map(c => letterOf(c[2]))
    if (!letters.every((l, i) => l.length === 1 && plausibleLetter(i, l))) return part
    const fixedRow = cells.map((c, i) => `<td${c[1]}>${LETTERS[i]}</td>`).join('')
    return part.replace(firstRow[1], fixedRow)
  })
}

function normalizeGapLabels(parts: string[]): string[] {
  let k = 0
  return parts.map(part =>
    isPlainText(part)
      ? part.replace(/(_{2,}\s*\(\s*)([^)\s]{1,8})(\s*\))/g, (whole, open, label, close) => {
          const letter = letterOf(label)
          if (letter.length !== 1 || !plausibleLetter(k, letter)) return whole
          return `${open}${LETTERS[k++]}${close}`
        })
      : part
  )
}

export function parseGeneric(pages: PaddlePage[]): ParsedExamDocument {
  const answerKey = findAnswerKey(pages)
  const answerKeyTable = answerKey?.map ?? null

  const rawTasks: JsonTaskRaw[] = []
  const bankCodeByNumber = new Map<number, string>()
  let cur: JsonTaskRaw | null = null
  let inSolution = false
  let inKey = false
  let imgSortOrder = 0

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx]
    const pageImgUrl = Object.values(page.inputImage).join('')
    const blocks = page.prunedResult.parsing_res_list

    for (const block of blocks) {
      // Заголовок задания, который PaddleOCR принял за колонтитул (стоит
      // первым на странице) — это граница задания, а не мусор колонтитула.
      const label = block.block_label === 'header' && SDAMGIA_TASK_TITLE.test(block.block_content.trim())
        ? 'paragraph_title'
        : block.block_label
      if (SKIP.has(label)) continue

      // Сводная таблица "Ключ" и всё после неё (в т.ч. её строки,
      // распознанные текстом) — не текст условия/решения последнего задания,
      // иначе она приклеится в его conditionParts (см. комментарий выше про
      // то, почему это раньше ломало ответы).
      if (answerKeyTable && isKeyTitle(block.block_content)) { inKey = true; continue }
      if (answerKeyTable && label === 'table' && parseAnswerKeyTable(block.block_content).size > 0) { inKey = true; continue }

      // New task boundary
      if (label === 'paragraph_title') {
        // "#" — необязателен: у PaddleOCR-VL-1.6 заголовок задания в
        // paragraph_title приходит БЕЗ markdown-решётки ("1. Тип 1 № 559"),
        // в отличие от книжного пайплайна (PP-StructureV3/книги), где
        // заголовок оформлен как "# 1." — жёсткое требование "#+" раньше
        // давало 0 совпадений на реальных тестах (найдено 2026-08-30 на
        // ОГЭ-варианте: 0 заданий распознано именно из-за этого).
        const m = block.block_content.match(/^#*\s*(\d+)\./)
        if (m) {
          if (cur) rawTasks.push(cur)
          const number = parseInt(m[1])
          cur = { number, conditionParts: [], solutionParts: [], answer: null, conditionImageRefs: [], solutionImageRefs: [] }
          inSolution = false
          inKey = false
          const bankCode = extractBankCode(block.block_content)
          if (bankCode) bankCodeByNumber.set(number, bankCode)
          continue
        }
        if (!cur || inKey) continue
        const title = block.block_content.replace(/^#+\s*/, '').trim()
        // Примечание / notes — attach to current solution
        if (title.includes('Примечание')) {
          cur.solutionParts.push('> ' + title)
        } else if (title) {
          // Подзаголовок внутри задания: столбцы задания на соответствие
          // («ФИЗИЧЕСКИЕ ВЕЛИЧИНЫ») или заголовок текста («Масс-спектрограф»)
          ;(inSolution ? cur.solutionParts : cur.conditionParts).push(`**${title}**`)
        }
        continue
      }

      if (!cur || inKey) continue

      // vision_footnote внутри задания — обычный текст (так пришли
      // утверждения «выберите два верных» в задании 16 варианта ОГЭ)
      if (label === 'text' || label === 'vision_footnote') {
        // полноширинные скобки «3）» — артефакт OCR, ломают нумерацию вариантов
        const c = block.block_content.trim().replace(/）/g, ')').replace(/（/g, '(')
        if (!c) continue

        // Сводная таблица найдена — она единственный источник ответа,
        // "Ответ:" в тексте задания больше не парсится как таковой (не
        // прерывает поток и не переключает inSolution) — иначе фраза
        // "Ответ:" в самом условии (например, разбор решённого примера)
        // могла бы что-то в этом раскладе сломать; без таблицы — старое
        // поведение (единственный прежде существовавший источник ответа).
        if (!answerKeyTable && c.match(/^Ответ[:\s]/)) {
          cur.answer = c.replace(/^Ответ[:\s]+/, '').replace(/<[^>]+>/g, '').trim()
          inSolution = true // answer is always after solution
          continue
        }

        // Solution marker
        if (c.startsWith('Решение.') || c === 'Решение') {
          inSolution = true
          const afterSol = c.replace(/^Решение\.?\s*/, '').trim()
          if (afterSol) cur.solutionParts.push(afterSol)
          continue
        }

        appendText(inSolution ? cur.solutionParts : cur.conditionParts, c)

      } else if (label === 'display_formula') {
        const f = block.block_content.trim()
        if (inSolution) cur.solutionParts.push(f)
        else cur.conditionParts.push(f)

      } else if (label === 'image' || label === 'chart') {
        const ref = { pageImgUrl, bbox: block.block_bbox, blockId: block.block_id, sortOrder: imgSortOrder++ }
        if (inSolution) cur.solutionImageRefs.push(ref)
        else cur.conditionImageRefs.push(ref)

      } else if (label === 'table') {
        // HTML table — как есть, кроме переносов в ячейках и водяного знака
        const table = fixCellLineBreaks(block.block_content.replace(SDAMGIA_WATERMARK_RE, ''))
        if (inSolution) cur.solutionParts.push(table)
        else cur.conditionParts.push(table)

      } else if (label === 'figure_title') {
        const caption = `*${block.block_content.replace(/^#+\s*/, '').trim()}*`
        if (inSolution) cur.solutionParts.push(caption)
        else cur.conditionParts.push(caption)
      }
    }
  }
  if (cur) rawTasks.push(cur)

  for (const t of rawTasks) {
    const withTable = normalizeLetterTable(t.conditionParts)
    const hasLetterTable = withTable.some((p, i) => p !== t.conditionParts[i])
    t.conditionParts = normalizeGapLabels(normalizeLetterLabels(withTable, hasLetterTable))
  }

  // Сводная таблица найдена — проставляем ответ каждой задаче по коду банка
  // (не по порядковому номеру, см. комментарий в начале файла), минуя всё,
  // что цикл выше мог случайно насобирать в cur.answer (там она осталась
  // null — блок "Ответ:" в тексте задания не парсился, пока answerKeyTable
  // задан, см. условие выше). Коды, которых нет в таблице, ищем в тексте
  // после неё — там бывают строки ключа, распознанные не таблицей.
  if (answerKey) {
    const allCodes = [...bankCodeByNumber.values()]
    const missing = allCodes.filter(code => !answerKey.map.has(code))
    const recovered = missing.length ? recoverKeyRows(answerKey.tail, missing, allCodes) : new Map<string, string>()
    for (const t of rawTasks) {
      const bankCode = bankCodeByNumber.get(t.number)
      const answer = bankCode ? (answerKey.map.get(bankCode) ?? recovered.get(bankCode)) : undefined
      if (answer) t.answer = answer
    }
  }

  // Build standard parsed format (without images — handled separately in pipeline)
  const tasks = rawTasks.map(t => {
    const promptText = t.conditionParts
      .join('\n\n')
      .replace(/\$\$[\s\S]*?\$\$/g, '[формула]')
      .replace(/\$[^$\n]+\$/g, '[формула]')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || `Задание ${t.number}`
    // Тип — по тому же решению о проверке, что и у ключа ответа: числовой
    // ввод только для настоящего числа. «Один из вариантов» не угадываем:
    // варианты ответа здесь не разбираются в options, и задание с таким
    // типом нельзя было бы решить (так вышло с заданием 16 варианта ОГЭ).
    const method = t.answer ? detectGradingMethodInContext(t.answer, promptText) : null
    return {
      number: t.number,
      prompt_text: promptText,
      prompt_html: t.conditionParts.join('\n\n'),
      task_type_guess: method === 'numeric_tolerance' ? 'numeric' : 'short_text',
      options: [],
      answer_parts: [],
      answer_format_hint: null,
      image_refs: t.conditionImageRefs.map(r => JSON.stringify(r)),
      images_placement: 'above_text',
      has_unmatched_images: t.conditionImageRefs.length > 0,
      source_pages: [1],
      confidence: 0.98,
    }
  })
  const promptByNumber = new Map(tasks.map(t => [t.number, t.prompt_text]))

  const answers = rawTasks
    .filter(t => t.answer)
    .map(t => {
      const method = detectGradingMethodInContext(t.answer!, promptByNumber.get(t.number) ?? '')
      return {
        task_number: t.number,
        correct_answer: normalizeAnswerForMethod(cleanParsedAnswer(t.answer!), method),
        grading_method_guess: method,
        confidence: 0.98,
      }
    })

  const solutions = rawTasks
    .filter(t => t.solutionParts.length > 0)
    .map(t => ({ task_number: t.number, solution_text: t.solutionParts.join('\n\n') }))

  return { meta: { title: '', subject: '', exam_type: '', grade: '' }, tasks, answers, solutions, warnings: collectWarnings(rawTasks, tasks, answerKey !== null, bankCodeByNumber), rawTasks }
}

// То, что разбор не смог восстановить сам, — учителю на странице проверки.
function collectWarnings(
  rawTasks: JsonTaskRaw[],
  tasks: { number: number; prompt_text: string }[],
  hasKey: boolean,
  bankCodeByNumber: Map<number, string>,
): ParseWarning[] {
  const warnings: ParseWarning[] = []
  const numbers = rawTasks.map(t => t.number)
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] > numbers[i - 1] + 1) {
      const from = numbers[i - 1] + 1, to = numbers[i] - 1
      warnings.push({
        task_number: null,
        warning_type: 'пропуск номера',
        description: from === to
          ? `Задание ${from} не распознано — после ${numbers[i - 1]} сразу идёт ${numbers[i]}. Проверьте, не приклеилось ли оно к соседнему.`
          : `Задания ${from}–${to} не распознаны — после ${numbers[i - 1]} сразу идёт ${numbers[i]}.`,
      })
    }
  }
  const raw = new Map(rawTasks.map(t => [t.number, t]))
  for (const t of tasks) {
    const r = raw.get(t.number)!
    if (/см\.?\s*рис|на\s+рисунке|изображ[её]н|на\s+схеме|на\s+графике/i.test(t.prompt_text) && r.conditionImageRefs.length === 0) {
      warnings.push({
        task_number: t.number,
        warning_type: 'нет рисунка',
        description: 'В условии есть ссылка на рисунок, но рисунок не распознан — добавьте его вручную.',
        snippet: t.prompt_text.slice(0, 160),
      })
    }
    if (hasKey && !r.answer && !requiresExplanation(t.prompt_text)) {
      const code = bankCodeByNumber.get(t.number)
      warnings.push({
        task_number: t.number,
        warning_type: 'нет ответа',
        description: `Ответ не найден в таблице «Ключ»${code ? ` (код задания ${code})` : ''} — без ответа задание проверяется вручную.`,
      })
    }
  }
  return warnings
}
