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
// задачи, что часто давало сбой (см. findAnswerKeyTable ниже): если
// PaddleOCR путал порядок блоков, "Ответ:" мог физически оказаться внутри
// текста следующего задания, и весь остаток попадал в его conditionParts.
// Когда сводная таблица найдена — она единственный источник ответов (по
// решению пользователя): "Ответ:" внутри текста заданий больше НЕ ищем
// вовсе, чтобы условие никогда не приняли за ответ. Привязка по коду банка
// (не по порядковому номеру) — устойчивее, если распознавание задания
// собьёт порядок.
import { cleanParsedAnswer, detectGradingMethod } from '@/lib/grading/answer-heuristics'
import type { JsonTaskRaw, ParsedExamDocument, PaddlePage } from './types'
import type { PaddleBlock } from './types'

const SKIP = new Set(['header', 'footer', 'number', 'header_image', 'footer_image'])

// Извлекает код банка задач из заголовка "## 1. Тип 1 № 408219". OCR
// искажает "№" множеством способов в реальных файлах ("No", "Ne", "Nо" —
// латиница/кириллица вперемешку) и часто оборачивает число в
// "$ \underline{\text{408219}} $" — привязываться к самому маркеру "№"
// ненадёжно. Вместо этого берём ПОСЛЕДНЕЕ число длиной 3-10 цифр во всём
// заголовке (короче — номер задания "1."/"Тип 1"/"Д30" не даёт ложных
// срабатываний, т.к. они однозначно короче кода банка).
function extractBankCode(title: string): string | null {
  const matches = [...title.matchAll(/\d{3,10}/g)]
  return matches.length > 0 ? matches[matches.length - 1][0] : null
}

// Разбирает HTML-таблицу "Ключ" (border=1, <tr><td>…) в Map<bankCode, answer>.
// Первая строка — заголовок ("№ п/п"/"№ задания"/"Ответ"), пропускаем.
function parseAnswerKeyTable(html: string): Map<string, string> {
  const out = new Map<string, string>()
  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c =>
      c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
    )
    if (cells.length < 3) continue
    const [, bankCode, answer] = cells
    if (/^\d{3,10}$/.test(bankCode) && answer) out.set(bankCode, answer)
  }
  return out
}

// Ищет по всем страницам таблицу "Ключ" — заголовок с текстом "Ключ"
// (header/paragraph_title/text), за которым (на той же или следующей
// значимой позиции) идёт table-блок с ожидаемыми тремя колонками.
function findAnswerKeyTable(pages: PaddlePage[]): Map<string, string> | null {
  for (const page of pages) {
    const blocks = page.prunedResult.parsing_res_list
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      if (!/^Ключ\s*$/i.test(b.block_content.replace(/^#+\s*/, '').trim())) continue
      const tableBlock = blocks.slice(i + 1).find((x: PaddleBlock) => x.block_label === 'table')
      if (!tableBlock) continue
      const map = parseAnswerKeyTable(tableBlock.block_content)
      if (map.size > 0) return map
    }
  }
  return null
}

export function parseGeneric(pages: PaddlePage[]): ParsedExamDocument {
  const answerKeyTable = findAnswerKeyTable(pages)

  const rawTasks: JsonTaskRaw[] = []
  const bankCodeByNumber = new Map<number, string>()
  let cur: JsonTaskRaw | null = null
  let inSolution = false
  let imgSortOrder = 0

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx]
    const pageImgUrl = Object.values(page.inputImage).join('')
    const blocks = page.prunedResult.parsing_res_list

    for (const block of blocks) {
      if (SKIP.has(block.block_label)) continue

      // Сводная таблица "Ключ" сама по себе (заголовок или table-блок) —
      // не текст условия/решения текущей задачи, пропускаем целиком,
      // иначе она приклеится в conditionParts последнего задания (см.
      // комментарий выше про то, почему это раньше ломало ответы).
      if (answerKeyTable && /^Ключ\s*$/i.test(block.block_content.replace(/^#+\s*/, '').trim())) continue
      if (answerKeyTable && block.block_label === 'table' && parseAnswerKeyTable(block.block_content).size > 0) continue

      // New task boundary
      if (block.block_label === 'paragraph_title') {
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
          const bankCode = extractBankCode(block.block_content)
          if (bankCode) bankCodeByNumber.set(number, bankCode)
          continue
        }
        // Примечание / notes — attach to current solution
        if (cur && block.block_content.includes('Примечание')) {
          cur.solutionParts.push('> ' + block.block_content.replace(/^#+\s*/, ''))
        }
        continue
      }

      if (!cur) continue

      if (block.block_label === 'text') {
        const c = block.block_content.trim()
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

        if (inSolution) cur.solutionParts.push(c)
        else cur.conditionParts.push(c)

      } else if (block.block_label === 'display_formula') {
        const f = block.block_content.trim()
        if (inSolution) cur.solutionParts.push(f)
        else cur.conditionParts.push(f)

      } else if (block.block_label === 'image' || block.block_label === 'chart') {
        const ref = { pageImgUrl, bbox: block.block_bbox, blockId: block.block_id, sortOrder: imgSortOrder++ }
        if (inSolution) cur.solutionImageRefs.push(ref)
        else cur.conditionImageRefs.push(ref)

      } else if (block.block_label === 'table') {
        // HTML table — keep as-is
        if (inSolution) cur.solutionParts.push(block.block_content)
        else cur.conditionParts.push(block.block_content)

      } else if (block.block_label === 'figure_title') {
        const caption = `*${block.block_content.replace(/^#+\s*/, '').trim()}*`
        if (inSolution) cur.solutionParts.push(caption)
        else cur.conditionParts.push(caption)
      }
    }
  }
  if (cur) rawTasks.push(cur)

  // Сводная таблица найдена — проставляем ответ каждой задаче по коду банка
  // (не по порядковому номеру, см. комментарий в начале файла), минуя всё,
  // что цикл выше мог случайно насобирать в cur.answer (там она осталась
  // null — блок "Ответ:" в тексте задания не парсился, пока answerKeyTable
  // задан, см. условие выше).
  if (answerKeyTable) {
    for (const t of rawTasks) {
      const bankCode = bankCodeByNumber.get(t.number)
      const answer = bankCode ? answerKeyTable.get(bankCode) : undefined
      if (answer) t.answer = answer
    }
  }

  // Build standard parsed format (without images — handled separately in pipeline)
  const tasks = rawTasks.map(t => ({
    number: t.number,
    prompt_text: t.conditionParts
      .join('\n\n')
      .replace(/\$\$[\s\S]*?\$\$/g, '[формула]')
      .replace(/\$[^$\n]+\$/g, '[формула]')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || `Задание ${t.number}`,
    prompt_html: t.conditionParts.join('\n\n'),
    task_type_guess: (() => {
      const ans = t.answer ?? ''
      if (/^-?\d+([.,]\d+)?$/.test(ans)) return 'numeric'
      if (t.conditionParts.join(' ').toLowerCase().includes('выберит') || t.conditionParts.join(' ').toLowerCase().includes('из предложен')) return 'single_choice'
      return 'short_text'
    })(),
    options: [],
    answer_parts: [],
    answer_format_hint: null,
    image_refs: t.conditionImageRefs.map(r => JSON.stringify(r)),
    images_placement: 'above_text',
    has_unmatched_images: t.conditionImageRefs.length > 0,
    source_pages: [1],
    confidence: 0.98,
  }))

  const answers = rawTasks
    .filter(t => t.answer)
    .map(t => ({
      task_number: t.number,
      correct_answer: cleanParsedAnswer(t.answer!),
      grading_method_guess: detectGradingMethod(t.answer!),
      confidence: 0.98,
    }))

  const solutions = rawTasks
    .filter(t => t.solutionParts.length > 0)
    .map(t => ({ task_number: t.number, solution_text: t.solutionParts.join('\n\n') }))

  return { meta: { title: '', subject: '', exam_type: '', grade: '' }, tasks, answers, solutions, warnings: [], rawTasks }
}
