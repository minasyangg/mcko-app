import { after } from 'next/server'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requiresExplanation, cleanParsedAnswer, detectGradingMethod, buildFormatHint } from '@/lib/grading/answer-heuristics'
import { submitPaddleOcrJob } from '@/lib/ocr/paddle-ocr'
import { parseExamDocument, type PaddlePage } from '@/lib/parsing/exam-parsers'
import { savePaddleOcrResult } from '@/lib/parsing/save-paddle-result'
import { getExamType, cleanupSourceDocuments, applyMatchingScoringRules } from '@/lib/parsing/pipeline-shared'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Загрузка файлов и отправка PDF-документов в PaddleOCR — быстрые операции
// (секунды), сам OCR-job не ждём здесь (см. PDF-ветку ниже и
// app/api/parsing/jobs/[id]/route.ts, который довершает импорт).
export const maxDuration = 60

interface UploadInfo {
  docType: 'tasks' | 'answers' | 'solutions'
  storagePath: string
  originalFilename: string
}

// Раньше здесь жило локальное извлечение картинок из PDF через pdfjs — для
// PDF-ветки на DeepSeek. PDF теперь тоже идёт через PaddleOCR (см. ниже),
// картинки достаются вырезкой по bbox из его же скана страницы
// (cropPageImage/uploadJsonTaskImages), как и для JSON-ветки — код удалён
// как мёртвый 2026-08-30 (см. память project_pdf_import_pipeline_redesign).

// ─── Match unmatched images to tasks by order ─────────────────────────────────

async function matchImagesToTasks(
  client: SupabaseClient<Database>,
  testVersionId: string
): Promise<number> {
  // Get unmatched images for this version
  const { data: unmatchedImages } = await client
    .from('task_media')
    .select('id, sort_order')
    .is('task_id', null)
    .like('storage_path', `task-media/${testVersionId}/%`)
    .order('sort_order', { ascending: true })

  if (!unmatchedImages?.length) return 0

  // Get tasks that DeepSeek flagged as having images
  const { data: tasksWithImages } = await client
    .from('test_tasks')
    .select('id, task_number, sort_order')
    .eq('test_version_id', testVersionId)
    .eq('has_images', true)
    .order('sort_order', { ascending: true })

  if (!tasksWithImages?.length) {
    // No tasks flagged — assign images to tasks in order
    const { data: allTasks } = await client
      .from('test_tasks')
      .select('id, task_number')
      .eq('test_version_id', testVersionId)
      .order('sort_order', { ascending: true })

    if (!allTasks?.length) return 0

    let matched = 0
    for (let i = 0; i < unmatchedImages.length; i++) {
      const taskIdx = Math.floor(i * allTasks.length / unmatchedImages.length)
      const task = allTasks[Math.min(taskIdx, allTasks.length - 1)]
      await client.from('task_media').update({ task_id: task.id }).eq('id', unmatchedImages[i].id)
      await client.from('test_tasks').update({ has_images: true }).eq('id', task.id)
      matched++
    }
    return matched
  }

  // Assign images to flagged tasks in order
  let matched = 0
  for (let i = 0; i < unmatchedImages.length; i++) {
    const taskIdx = i % tasksWithImages.length
    const task = tasksWithImages[taskIdx]
    await client.from('task_media').update({ task_id: task.id }).eq('id', unmatchedImages[i].id)
    matched++
  }
  return matched
}

// DeepSeek для PDF-импорта удалён 2026-08-30 — PDF теперь распознаётся через
// PaddleOCR (lib/ocr/paddle-ocr.ts), см. память project_pdf_import_pipeline_redesign.
// Развёрнутые письменные ответы по-прежнему временно не проверяются ИИ —
// см. lib/grading/finalize.ts (checkWithAI, отключено тем же решением).

// ─── MD file parser ──────────────────────────────────────────────────────────

interface MdParsedTask {
  number: number
  prompt_text: string
  prompt_html: string
  task_type_guess: string
  options: unknown[]
  answer_parts: unknown[]
  answer_format_hint: null
  image_refs: string[]
  images_placement: string
  has_unmatched_images: boolean
  source_pages: number[]
  confidence: number
}

function parseMdContent(mdText: string): {
  meta: Record<string, string>
  tasks: MdParsedTask[]
  answers: { task_number: number; correct_answer: string; grading_method_guess: string; confidence: number }[]
  solutions: { task_number: number; solution_text: string }[]
  warnings: unknown[]
} {
  // Find all ## N. headings and their positions
  const headingRegex = /^(## (\d+)\..+)$/gm
  const headings: { index: number; header: string; number: number }[] = []
  let m
  while ((m = headingRegex.exec(mdText)) !== null) {
    const num = parseInt(m[2])
    if (num > 0) headings.push({ index: m.index, header: m[1], number: num })
  }

  // Extract meta from preamble
  const preamble = mdText.slice(0, headings[0]?.index ?? 0)
  const titleMatch = preamble.match(/^#\s+(.+)$/m)
  const meta = { title: titleMatch?.[1]?.trim() ?? '', subject: '', exam_type: '', grade: '' }

  const tasks: MdParsedTask[] = []
  const answers: { task_number: number; correct_answer: string; grading_method_guess: string; confidence: number }[] = []
  const solutions: { task_number: number; solution_text: string }[] = []

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    const blockStart = h.index + h.header.length
    const blockEnd = i + 1 < headings.length ? headings[i + 1].index : mdText.length
    const content = mdText.slice(blockStart, blockEnd).trim()

    // Split at "Решение." (marks start of solution)
    const solSplit = content.search(/\nРешение\./)
    let promptBlock = content
    let afterSolution = ''

    if (solSplit !== -1) {
      promptBlock = content.slice(0, solSplit).trim()
      afterSolution = content.slice(solSplit + '\nРешение.'.length)

      // Extract answer after "Ответ:"
      const ansMatch = afterSolution.match(/\nОтвет:\s*([\s\S]+?)(?=\n\n|\n##|\n#####|$)/)
      if (ansMatch) {
        const rawAnswer = ansMatch[1].trim()
        // Strip HTML tags from answer (may contain table markup)
        const cleanAnswer = rawAnswer.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        if (cleanAnswer) {
          const isNumeric = /^-?\d+([.,]\d+)?$/.test(cleanAnswer)
          answers.push({
            task_number: h.number,
            correct_answer: cleanAnswer,
            grading_method_guess: isNumeric ? 'numeric_tolerance' : 'normalized',
            confidence: 0.95,
          })
        }
        // Solution is text between "Решение." and "Ответ:"
        const solText = afterSolution.slice(0, afterSolution.indexOf('\nОтвет:')).trim()
        if (solText) solutions.push({ task_number: h.number, solution_text: solText })
      } else {
        const solText = afterSolution.trim()
        if (solText) solutions.push({ task_number: h.number, solution_text: solText })
      }
    }

    // Collect image URLs from prompt block only (images will go to task_media)
    const imgUrls: string[] = []
    const imgRe = /<img[^>]+src="([^"]+)"/g
    let imgM
    while ((imgM = imgRe.exec(promptBlock)) !== null) imgUrls.push(imgM[1])

    // prompt_html: strip <img> tags (images handled by task_media gallery), keep KaTeX and text
    const promptHtml = promptBlock.replace(/<div[^>]*>\s*<img[^>]+>\s*<\/div>/g, '').replace(/<img[^>]+>/g, '').trim()

    // prompt_text: plain text fallback (strip all tags and formula delimiters)
    const promptText = promptHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\$\$[\s\S]+?\$\$/g, '[формула]')
      .replace(/\$[^$\n]+\$/g, '[формула]')
      .replace(/\s+/g, ' ')
      .trim() || h.header

    const hasAnswer = answers.some(a => a.task_number === h.number)
    const isNumericAnswer = hasAnswer && answers.find(a => a.task_number === h.number)?.grading_method_guess === 'numeric_tolerance'

    tasks.push({
      number: h.number,
      prompt_text: promptText,
      prompt_html: promptHtml,
      task_type_guess: isNumericAnswer ? 'numeric' : 'short_text',
      options: [],
      answer_parts: [],
      answer_format_hint: null,
      image_refs: imgUrls,
      images_placement: 'above_text',
      has_unmatched_images: imgUrls.length > 0,
      source_pages: [1],
      confidence: 0.95,
    })
  }

  return { meta, tasks, answers, solutions, warnings: [] }
}

// ─── Download and upload MD external images ───────────────────────────────────

async function downloadAndUploadMdImages(
  imgUrls: string[],
  testVersionId: string,
  client: SupabaseClient<Database>
): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>()
  const uniqueUrls = [...new Set(imgUrls)]
  if (!uniqueUrls.length) return urlMap

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let sharpLib: typeof import('sharp') | null = null
  try { sharpLib = require('sharp') } catch { console.warn('[md-images] sharp not available'); return urlMap }

  for (let i = 0; i < uniqueUrls.length; i++) {
    const url = uniqueUrls[i]
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) { console.warn(`[md-images] ${res.status} for ${url}`); continue }

      const buf = Buffer.from(await res.arrayBuffer())
      const origMeta = await sharpLib!(buf).metadata()

      const webpBuf = await sharpLib!(buf)
        .resize({ width: 1200, withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer()

      const storagePath = `task-media/${testVersionId}/md_${i}.webp`
      const { error: upErr } = await client.storage
        .from('task-media')
        .upload(storagePath, webpBuf, { contentType: 'image/webp', upsert: true })

      if (upErr) { console.error(`[md-images] upload error:`, upErr.message); continue }

      await client.from('task_media').insert({
        task_id: null,
        storage_path: storagePath,
        media_type: 'image',
        format: 'webp',
        width_px: origMeta.width ?? null,
        height_px: origMeta.height ?? null,
        file_size_bytes: webpBuf.length,
        is_manually_uploaded: false,
        placement: 'above_text',
        sort_order: i,
      })

      urlMap.set(url, storagePath)
    } catch (e) {
      console.error(`[md-images] error for ${url}:`, (e as Error).message)
    }
  }

  console.log(`[md-images] uploaded ${urlMap.size}/${uniqueUrls.length}`)
  return urlMap
}

// ─── PaddleOCR JSON: разбор готовых страниц по типу экзамена ────────────────
// Алгоритм разбора (lib/parsing/exam-parsers/), вырезка картинок по bbox и
// сохранение в БД (lib/parsing/save-paddle-result.ts), применение правил
// баллов и очистка исходников (lib/parsing/pipeline-shared.ts) — общие для
// JSON- и PDF-веток (обе отдают страницы в одном формате PaddlePage[]),
// вынесены в lib/, чтобы их мог использовать и app/api/parsing/jobs/[id]
// (там довершается PDF-ветка после ответа PaddleOCR).

// Delete all Storage files for a version folder (task-media/{versionId}/*)
export async function deleteVersionStorage(
  client: SupabaseClient<Database>,
  testVersionId: string
): Promise<void> {
  const { data: files } = await client.storage.from('task-media').list(testVersionId)
  if (files?.length) {
    const paths = files.map(f => `${testVersionId}/${f.name}`)
    await client.storage.from('task-media').remove(paths)
  }
}

// Delete Storage files for specific task_media rows
export async function deleteTaskMediaFiles(
  client: SupabaseClient<Database>,
  storagePaths: string[]
): Promise<void> {
  if (!storagePaths.length) return
  await client.storage.from('task-media').remove(storagePaths)
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

async function runParsing(jobId: string, testVersionId: string, docIds: string[]): Promise<void> {
  const client = createAdminClient()
  const mark = (msg: string) => client.from('parsing_jobs').update({ error_message: msg }).eq('id', jobId)

  try {
    await client.from('parsing_jobs')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', jobId)

    // Detect file type: JSON > MD > PDF
    const { data: docInfos } = await client.from('test_documents')
      .select('id,storage_path,doc_type')
      .in('id', docIds)
    const jsonDoc = docInfos?.find(d => d.storage_path.endsWith('.json') && d.doc_type === 'tasks')
    const mdDoc = !jsonDoc ? docInfos?.find(d => d.storage_path.endsWith('.md') && d.doc_type === 'tasks') : null

    let tasks: any[], answers: any[], solutions: any[], imagesExtracted = 0, imagesAttached = 0

    if (jsonDoc) {
      // ── PaddleOCR JSON pipeline ───────────────────────────────────────────────
      // Файл уже прошёл PaddleOCR (учитель прогнал его сам) — OCR не нужен,
      // сразу отдаём страницы в алгоритм парсинга по типу экзамена.
      await mark('Downloading JSON file')
      const { data: blob, error: dlErr } = await client.storage.from('test-documents').download(jsonDoc.storage_path)
      if (dlErr || !blob) throw new Error(`Failed to download JSON file: ${dlErr?.message}`)

      await client.from('test_documents').update({ parse_status: 'text_extracted' }).eq('id', jsonDoc.id)

      const jsonText = await blob.text()
      const pages: PaddlePage[] = JSON.parse(jsonText)
      const examType = await getExamType(client, testVersionId)
      await mark(`Разбор заданий (${examType ?? 'без типа'})`)
      const summary = await savePaddleOcrResult(client, jobId, testVersionId, pages, examType)
      console.log(`[parsing/json] done: ${summary.tasks_found} tasks, ${summary.images_extracted} images`)
      return

    } else if (mdDoc) {
      // ── MD pipeline ──────────────────────────────────────────────────────────
      await mark('Downloading MD file')
      const { data: blob, error: dlErr } = await client.storage.from('test-documents').download(mdDoc.storage_path)
      if (dlErr || !blob) throw new Error(`Failed to download MD file: ${dlErr?.message}`)

      await client.from('test_documents').update({ parse_status: 'text_extracted' }).eq('id', mdDoc.id)

      const mdContent = await blob.text()
      await mark(`Parsing MD (${mdContent.length} chars)`)
      const parsed = parseMdContent(mdContent)
      tasks = parsed.tasks
      answers = parsed.answers
      solutions = parsed.solutions

      // Collect all unique image URLs across all tasks
      const allImgUrls = [...new Set(tasks.flatMap((t: any) => t.image_refs as string[]))]
      if (allImgUrls.length > 0) {
        await mark(`Downloading ${allImgUrls.length} images from MD`)
        await downloadAndUploadMdImages(allImgUrls, testVersionId, client)
        imagesExtracted = allImgUrls.length
      }
    } else {
      // ── PDF pipeline (PaddleOCR, асинхронно) ─────────────────────────────────
      // Только отправляем документы на распознавание и возвращаемся: сам OCR-job
      // может идти дольше serverless-таймаута, особенно если несколько учителей
      // парсят PDF одновременно — PaddleOCR обрабатывает job'ы своей очередью,
      // мы её не дублируем. Импорт довершает GET /api/parsing/jobs/[id] на
      // каждом опросе статуса фронтендом, когда PaddleOCR закончит job —
      // тем же опросом учитель видит живой прогресс, а не "подвисший" запрос.
      const examType = await getExamType(client, testVersionId)
      const ocrDocs: Array<{ docId: string; filename: string; ocrJobId: string }> = []

      for (const docId of docIds) {
        const { data: doc } = await client.from('test_documents').select('id,storage_path,doc_type,original_filename').eq('id', docId).single()
        if (!doc) continue

        await mark(`Загрузка документа (${doc.doc_type})`)
        const { data: blob, error: dlErr } = await client.storage.from('test-documents').download(doc.storage_path)
        if (dlErr || !blob) {
          await client.from('test_documents').update({ parse_status: 'failed' }).eq('id', docId)
          continue
        }

        const buffer = Buffer.from(await blob.arrayBuffer())
        const filename = doc.original_filename || doc.storage_path.split('/').pop() || `${doc.doc_type}.pdf`

        await mark(`Отправка документа на распознавание (${doc.doc_type})`)
        const ocrJobId = await submitPaddleOcrJob(buffer, filename)
        await client.from('test_documents').update({ parse_status: 'text_extracted' }).eq('id', docId)
        ocrDocs.push({ docId, filename, ocrJobId })
      }

      if (!ocrDocs.length) {
        throw new Error('Не удалось отправить ни один PDF-документ на распознавание.')
      }

      await client.from('parsing_jobs').update({
        ocr_state: { examType, docs: ocrDocs.map(d => ({ ...d, state: 'pending' })) },
        error_message: 'Распознавание документа — обычно занимает 1-3 минуты',
      }).eq('id', jobId)

      console.log(`[parsing/pdf] submitted ${ocrDocs.length} OCR job(s) for test_version=${testVersionId}, waiting for /api/parsing/jobs/[id] poll`)
      return
    }

    await mark(`Saving ${tasks.length} tasks`)

    const ansMap = new Map(answers.map((a: any) => [a.task_number, a]))
    const solMap = new Map(solutions.map((s: any) => [s.task_number, s]))
    let inserted = 0, matchedAns = 0, matchedSol = 0

    for (const t of tasks) {
      const needsExplanation = requiresExplanation(t.prompt_text ?? '')
      const { data: task, error: te } = await client.from('test_tasks').insert({
        test_version_id: testVersionId,
        task_number: t.number,
        sort_order: t.number,
        prompt_text: t.prompt_text,
        prompt_html: t.prompt_html ?? null,
        task_type: needsExplanation ? 'manual_review' : (t.task_type_guess ?? 'short_text'),
        options: Array.isArray(t.options) && t.options.length ? t.options : null,
        answer_format_hint: t.answer_format_hint ?? null,
        grading_method: needsExplanation ? 'manual' : 'normalized',
        parse_confidence: t.confidence ?? 0.8,
        has_images: t.has_unmatched_images ?? false,
        source_pages: Array.isArray(t.source_pages) ? t.source_pages : [1],
        review_status: 'pending',
        max_score: 1,
      }).select('id').single()

      if (te || !task) { console.warn('task error:', te?.message); continue }
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
          parse_confidence: ans.confidence ?? 0.8,
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
    }

    // Match uploaded images to tasks
    if (imagesExtracted > 0) {
      await mark(`Matching ${imagesExtracted} images to tasks`)
      imagesAttached = await matchImagesToTasks(client, testVersionId)
    }

    await applyMatchingScoringRules(client, testVersionId)

    const summary = {
      tasks_found: inserted,
      answers_matched: matchedAns,
      solutions_matched: matchedSol,
      images_extracted: imagesExtracted,
      images_attached: imagesAttached,
      warnings_count: 0,
    }

    await client.from('parsing_jobs').update({
      status: 'done',
      error_message: null,
      completed_at: new Date().toISOString(),
      result_summary: summary,
    }).eq('id', jobId)

    if (inserted > 0) {
      await client.from('test_versions').update({ status: 'in_review' }).eq('id', testVersionId)
    }
    await cleanupSourceDocuments(client, testVersionId)
    console.log(`[parsing] done: ${inserted} tasks, ${imagesExtracted} images`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[parsing] fatal:', msg)
    await client.from('parsing_jobs').update({
      status: 'failed',
      error_message: msg,
      completed_at: new Date().toISOString(),
    }).eq('id', jobId)
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['teacher', 'admin'].includes(profile.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { test_version_id, uploads } = body as { test_version_id: string; uploads: UploadInfo[] }

    if (!test_version_id || !Array.isArray(uploads) || uploads.length === 0) {
      return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }

    // Доступ к версии через user-клиент: RLS пускает учителя только к своим
    // тестам, админа — к тестам организации. Чужая версия → 404.
    const { data: version } = await supabase
      .from('test_versions').select('id').eq('id', test_version_id).single()
    if (!version) return Response.json({ error: 'Version not found' }, { status: 404 })

    const adminClient = createAdminClient()
    const docIds: string[] = []

    for (const upload of uploads) {
      const { data: doc, error: docError } = await adminClient.from('test_documents').insert({
        test_version_id,
        doc_type: upload.docType,
        storage_path: upload.storagePath,
        original_filename: upload.originalFilename,
        parse_status: 'pending',
      }).select('id').single()

      if (docError || !doc) {
        return Response.json({ error: `Failed to create document record: ${docError?.message}` }, { status: 500 })
      }
      docIds.push(doc.id)
    }

    const { data: job, error: jobError } = await adminClient
      .from('parsing_jobs')
      .insert({ test_version_id, status: 'queued' })
      .select('id')
      .single()

    if (jobError || !job) {
      return Response.json({ error: jobError?.message || 'Failed to create parsing job' }, { status: 500 })
    }

    after(() => runParsing(job.id, test_version_id, docIds))

    return Response.json({ job_id: job.id })
  } catch (err) {
    console.error('[parsing/trigger]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
