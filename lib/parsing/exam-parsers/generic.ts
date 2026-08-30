// Универсальный алгоритм парсинга PaddleOCR-JSON — используется, когда для
// типа экзамена нет своего модуля (см. index.ts), и для документов без
// указанного типа ("иной документ"). Разбивает страницы по номерам заданий
// (# N.), ищет "Ответ:"/"Решение." — рассчитан на текстовые задачники/тесты
// со сквозной нумерацией, без специфичной для конкретного экзамена вёрстки.
import { cleanParsedAnswer, detectGradingMethod } from '@/lib/grading/answer-heuristics'
import type { JsonTaskRaw, ParsedExamDocument, PaddlePage } from './types'

const SKIP = new Set(['header', 'footer', 'number', 'header_image', 'footer_image'])

export function parseGeneric(pages: PaddlePage[]): ParsedExamDocument {
  const rawTasks: JsonTaskRaw[] = []
  let cur: JsonTaskRaw | null = null
  let inSolution = false
  let imgSortOrder = 0

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx]
    const pageImgUrl = Object.values(page.inputImage).join('')
    const blocks = page.prunedResult.parsing_res_list

    for (const block of blocks) {
      if (SKIP.has(block.block_label)) continue

      // New task boundary
      if (block.block_label === 'paragraph_title') {
        const m = block.block_content.match(/^#+\s+(\d+)\./)
        if (m) {
          if (cur) rawTasks.push(cur)
          cur = { number: parseInt(m[1]), conditionParts: [], solutionParts: [], answer: null, conditionImageRefs: [], solutionImageRefs: [] }
          inSolution = false
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

        if (c.match(/^Ответ[:\s]/)) {
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
