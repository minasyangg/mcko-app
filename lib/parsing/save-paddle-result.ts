// Общая логика "готовые страницы PaddleOCR → задания в БД". Используется
// и JSON-веткой импорта (страницы уже есть в загруженном файле, PaddleOCR
// не нужен — см. п.2 решения пользователя от 2026-08-30: JSON пропускает
// OCR и сразу идёт в алгоритм парсинга), и PDF-веткой — но для PDF это
// вызывается ИЗ app/api/parsing/jobs/[id]/route.ts, когда асинхронный job
// PaddleOCR завершается (см. lib/ocr/paddle-ocr.ts), а не сразу из триггера:
// OCR может идти дольше одного serverless-запроса, особенно если несколько
// учителей парсят одновременно и PaddleOCR обрабатывает job'ы по очереди —
// поэтому триггер только отправляет job и возвращается, а этот модуль
// довершает импорт при следующем опросе статуса фронтендом.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { requiresExplanation, cleanParsedAnswer, detectGradingMethod, buildFormatHint } from '@/lib/grading/answer-heuristics'
import { parseExamDocument, type PaddlePage, type JsonImageRef } from '@/lib/parsing/exam-parsers'
import { applyMatchingScoringRules, cleanupSourceDocuments } from '@/lib/parsing/pipeline-shared'

type AdminClient = SupabaseClient<Database>

// Download and crop a region from a full page image
const _pageImgCache = new Map<string, Buffer>()

async function cropPageImage(
  pageImgUrl: string,
  bbox: [number, number, number, number],
  sharpLib: typeof import('sharp')
): Promise<Buffer | null> {
  try {
    let pageBuf = _pageImgCache.get(pageImgUrl)
    if (!pageBuf) {
      const res = await fetch(pageImgUrl, { signal: AbortSignal.timeout(30000) })
      if (!res.ok) return null
      pageBuf = Buffer.from(await res.arrayBuffer())
      _pageImgCache.set(pageImgUrl, pageBuf)
    }
    const [x1, y1, x2, y2] = bbox
    const w = Math.max(1, x2 - x1)
    const h = Math.max(1, y2 - y1)
    return await sharpLib(pageBuf)
      .extract({ left: x1, top: y1, width: w, height: h })
      .resize({ width: 900, withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer()
  } catch (e) {
    console.error('[json-img] crop error:', (e as Error).message)
    return null
  }
}

// Upload JSON-sourced images for a task (exact matching by block structure)
async function uploadJsonTaskImages(
  imageRefs: JsonImageRef[],
  taskId: string,
  taskNumber: number,
  testVersionId: string,
  client: AdminClient
): Promise<number> {
  if (!imageRefs.length) return 0
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let sharpLib: typeof import('sharp') | null = null
  try { sharpLib = require('sharp') } catch { return 0 }

  let uploaded = 0
  for (const ref of imageRefs) {
    const cropped = await cropPageImage(ref.pageImgUrl, ref.bbox, sharpLib!)
    if (!cropped) continue

    const storagePath = `task-media/${testVersionId}/t${taskNumber}_b${ref.blockId}.webp`
    const { error: upErr } = await client.storage
      .from('task-media')
      .upload(storagePath, cropped, { contentType: 'image/webp', upsert: true })
    if (upErr) { console.error('[json-img] upload:', upErr.message); continue }

    const meta = await sharpLib!(cropped).metadata()
    await client.from('task_media').insert({
      task_id: taskId,
      storage_path: storagePath,
      media_type: 'image',
      format: 'webp',
      width_px: meta.width ?? null,
      height_px: meta.height ?? null,
      file_size_bytes: cropped.length,
      is_manually_uploaded: false,
      placement: 'above_text',
      sort_order: ref.sortOrder,
    })
    uploaded++
  }
  _pageImgCache.clear() // free memory after a test version is processed
  return uploaded
}

// Upload solution images to solution_media (not visible to students without approval)
async function uploadJsonSolutionImages(
  imageRefs: JsonImageRef[],
  solutionId: string,
  taskNumber: number,
  testVersionId: string,
  client: AdminClient
): Promise<void> {
  if (!imageRefs.length) return
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let sharpLib: typeof import('sharp') | null = null
  try { sharpLib = require('sharp') } catch { return }

  for (const ref of imageRefs) {
    const cropped = await cropPageImage(ref.pageImgUrl, ref.bbox, sharpLib!)
    if (!cropped) continue

    // приватный bucket — solution_media открывается только после одобрения
    // solution_requests (см. lib/media/signed-urls.ts), в отличие от task-media
    const storagePath = `${testVersionId}/sol_t${taskNumber}_b${ref.blockId}.webp`
    const { error: upErr } = await client.storage
      .from('solution-media')
      .upload(storagePath, cropped, { contentType: 'image/webp', upsert: true })
    if (upErr) { console.error('[json-sol-img] upload:', upErr.message); continue }

    const meta = await sharpLib!(cropped).metadata()
    await client.from('solution_media').insert({
      solution_id: solutionId,
      storage_path: storagePath,
      media_type: 'image',
      format: 'webp',
      width_px: meta.width ?? null,
      height_px: meta.height ?? null,
      file_size_bytes: cropped.length,
      sort_order: ref.sortOrder,
    })
  }
}

export interface SavePaddleResultSummary {
  tasks_found: number
  answers_matched: number
  solutions_matched: number
  images_extracted: number
  images_attached: number
  warnings_count: number
}

// Разбирает страницы алгоритмом под exam_type, пишет задания/ответы/решения/
// картинки в БД, применяет правила баллов и закрывает parsing_job. Общий
// финал для JSON- и PDF(после OCR)-веток.
export async function savePaddleOcrResult(
  client: AdminClient,
  jobId: string,
  testVersionId: string,
  pages: PaddlePage[],
  examType: string | null
): Promise<SavePaddleResultSummary> {
  const { tasks, answers, solutions, rawTasks } = parseExamDocument(examType, pages)

  const ansMap = new Map(answers.map((a: any) => [a.task_number, a]))
  const solMap = new Map(solutions.map((s: any) => [s.task_number, s]))
  const rawMap = new Map(rawTasks.map(t => [t.number, t]))
  let inserted = 0, matchedAns = 0, matchedSol = 0, totalImgs = 0

  for (const t of tasks) {
    // Tasks with explanation keywords → always manual (AI semantic grading)
    const needsExplanation = requiresExplanation(t.prompt_text ?? '')
    const { data: task, error: te } = await client.from('test_tasks').insert({
      test_version_id: testVersionId,
      task_number: t.number,
      sort_order: t.number,
      prompt_text: t.prompt_text,
      prompt_html: t.prompt_html ?? null,
      task_type: needsExplanation ? 'manual_review' : (t.task_type_guess ?? 'short_text'),
      options: null,
      answer_format_hint: null,
      grading_method: needsExplanation ? 'manual' : 'normalized',
      parse_confidence: t.confidence ?? 0.98,
      has_images: t.has_unmatched_images ?? false,
      source_pages: [1],
      review_status: 'pending',
      max_score: 1,
    }).select('id').single()
    if (te || !task) { console.warn('task insert error:', te?.message); continue }
    inserted++

    const ans = ansMap.get(t.number) as any
    if (ans?.correct_answer != null) {
      const rawAns = String(ans.correct_answer)
      const cleanedAns = cleanParsedAnswer(rawAns)
      const method = needsExplanation ? 'manual' : detectGradingMethod(rawAns)
      const hint = buildFormatHint(rawAns, method)
      const { error: ae } = await client.from('task_answer_keys').insert({
        task_id: task.id,
        correct_answer: cleanedAns,
        grading_method: method,
        parse_confidence: ans.confidence ?? 0.98,
      })
      if (!ae) {
        matchedAns++
        await client.from('test_tasks').update({
          grading_method: method,
          ...(hint ? { answer_format_hint: hint } : {}),
        }).eq('id', task.id)
      }
    }

    const sol = solMap.get(t.number) as any
    if (sol?.solution_text) {
      const { error: se } = await client.from('task_solutions').insert({ task_id: task.id, solution_text: sol.solution_text })
      if (!se) matchedSol++
    }

    // Upload condition images directly with task_id
    const raw = rawMap.get(t.number)
    if (raw?.conditionImageRefs.length) {
      const imgCount = await uploadJsonTaskImages(raw.conditionImageRefs, task.id, t.number, testVersionId, client)
      if (imgCount > 0) {
        await client.from('test_tasks').update({ has_images: true }).eq('id', task.id)
        totalImgs += imgCount
      }
    }

    // Upload solution images to solution_media (only visible when student requests solution)
    if (sol?.solution_text && raw?.solutionImageRefs.length) {
      const { data: solRow } = await client
        .from('task_solutions').select('id').eq('task_id', task.id).single()
      if (solRow) {
        await uploadJsonSolutionImages(raw.solutionImageRefs, solRow.id, t.number, testVersionId, client)
      }
    }
  }

  await applyMatchingScoringRules(client, testVersionId)

  const summary: SavePaddleResultSummary = {
    tasks_found: inserted,
    answers_matched: matchedAns,
    solutions_matched: matchedSol,
    images_extracted: totalImgs,
    images_attached: totalImgs,
    warnings_count: 0,
  }

  await client.from('parsing_jobs').update({
    status: 'done',
    error_message: null,
    completed_at: new Date().toISOString(),
    result_summary: { ...summary },
  }).eq('id', jobId)

  if (inserted > 0) await client.from('test_versions').update({ status: 'in_review' }).eq('id', testVersionId)
  await cleanupSourceDocuments(client, testVersionId)
  console.log(`[parsing] done: ${inserted} tasks, ${totalImgs} images (examType=${examType ?? 'none'})`)

  return summary
}
