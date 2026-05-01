import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedTask {
  number: number
  prompt_text: string
  task_type_guess:
    | "single_choice"
    | "multiple_choice"
    | "short_text"
    | "numeric"
    | "composite"
    | "manual_review"
  options?: Array<{ id: string; text: string }>
  answer_parts?: Array<{ label: string; type: string }>
  answer_format_hint?: string
  image_refs: string[]
  images_placement: "above_text" | "below_text" | "inline"
  has_unmatched_images: boolean
  source_pages: number[]
  confidence: number
}

interface ParsedAnswer {
  task_number: number
  correct_answer: string | string[] | Record<string, string>
  grading_method_guess: "exact" | "normalized" | "numeric_tolerance" | "set_match" | "manual"
  confidence: number
}

interface ParsedSolution {
  task_number: number
  solution_text: string
  confidence: number
}

interface ParsedTestResult {
  meta: { title?: string; subject?: string; exam_type?: string; grade?: string }
  tasks: ParsedTask[]
  answers: ParsedAnswer[]
  solutions: ParsedSolution[]
  warnings: Array<{ type: string; description: string; task_number?: number }>
}

interface TextItem {
  str: string
  transform?: number[]
}

interface ExtractedPageText {
  page: number
  text: string
}

// ---------------------------------------------------------------------------
// Supabase admin client helper
// ---------------------------------------------------------------------------

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL")!
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ---------------------------------------------------------------------------
// PDF text extraction using pdfjs-dist
// ---------------------------------------------------------------------------

async function extractTextFromPdf(
  pdfBytes: ArrayBuffer
): Promise<{ pages: ExtractedPageText[]; pageCount: number }> {
  // Dynamic import to handle potential Deno compatibility issues
  const pdfjs = await import("npm:pdfjs-dist@3.11.174/legacy/build/pdf.mjs")

  // Disable worker in Deno environment
  // deno-lint-ignore no-explicit-any
  ;(pdfjs as any).GlobalWorkerOptions = (pdfjs as any).GlobalWorkerOptions ?? {}
  // deno-lint-ignore no-explicit-any
  ;(pdfjs as any).GlobalWorkerOptions.workerSrc = ""

  const data = new Uint8Array(pdfBytes)
  // deno-lint-ignore no-explicit-any
  const loadingTask = (pdfjs as any).getDocument({ data, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true })
  const pdf = await loadingTask.promise
  const pageCount: number = pdf.numPages
  const pages: ExtractedPageText[] = []

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const textContent = await page.getTextContent()
    const text = (textContent.items as TextItem[])
      .map((item) => item.str ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
    pages.push({ page: pageNum, text })
  }

  return { pages, pageCount }
}

// ---------------------------------------------------------------------------
// PDF image extraction using pdfjs-dist operator list
// ---------------------------------------------------------------------------

async function extractImagesFromPdf(
  pdfBytes: ArrayBuffer,
  supabase: ReturnType<typeof createClient>,
  testVersionId: string,
  docId: string
): Promise<{ count: number; mediaPaths: string[] }> {
  const pdfjs = await import("npm:pdfjs-dist@3.11.174/legacy/build/pdf.mjs")

  // deno-lint-ignore no-explicit-any
  ;(pdfjs as any).GlobalWorkerOptions = (pdfjs as any).GlobalWorkerOptions ?? {}
  // deno-lint-ignore no-explicit-any
  ;(pdfjs as any).GlobalWorkerOptions.workerSrc = ""

  const data = new Uint8Array(pdfBytes)
  // deno-lint-ignore no-explicit-any
  const loadingTask = (pdfjs as any).getDocument({ data, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true })
  const pdf = await loadingTask.promise

  const mediaPaths: string[] = []
  let globalImgIndex = 0

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    try {
      const page = await pdf.getPage(pageNum)
      const opList = await page.getOperatorList()
      // deno-lint-ignore no-explicit-any
      const OPS = (pdfjs as any).OPS

      for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i]
        const isPaintImage =
          fn === OPS.paintImageXObject ||
          fn === OPS.paintInlineImageXObject ||
          fn === OPS.paintImageXObjectRepeat

        if (!isPaintImage) continue

        try {
          const imgName = opList.argsArray[i]?.[0] as string | undefined
          if (!imgName) continue

          const objs = page.commonObjs
          let imgData: { data: Uint8Array; width: number; height: number } | null = null

          // Try to retrieve image data from page objects
          try {
            imgData = await new Promise((resolve, reject) => {
              // deno-lint-ignore no-explicit-any
              const obj = (page as any).objs?.get(imgName) ?? (objs as any)?.get(imgName)
              if (obj?.data) {
                resolve(obj)
              } else {
                // Some images may not be directly accessible; skip
                reject(new Error("no data"))
              }
            })
          } catch {
            continue
          }

          if (!imgData?.data) continue

          // Convert raw RGBA to a simple PNG-like representation
          // We store as raw bytes in webp bucket path but keep content type image/webp
          // For a true webp we'd need a canvas, but in Deno we store the raw image bytes
          // and rely on the browser to handle rendering via signed URL
          const storagePath = `task-media/raw/${testVersionId}/doc_${docId}_page_${pageNum}_img_${globalImgIndex}.webp`

          const { error: uploadErr } = await supabase.storage
            .from("task-media")
            .upload(storagePath, imgData.data, {
              contentType: "image/webp",
              upsert: true,
            })

          if (uploadErr) {
            console.warn(`Image upload failed for ${storagePath}: ${uploadErr.message}`)
            globalImgIndex++
            continue
          }

          // Create task_media record with task_id = null (unmatched)
          await supabase.from("task_media").insert({
            storage_path: storagePath,
            task_id: null,
            media_type: "image",
            format: "webp",
            source_page: pageNum,
            is_manually_uploaded: false,
          })

          mediaPaths.push(storagePath)
          globalImgIndex++
        } catch (imgErr) {
          console.warn(`Image extraction error on page ${pageNum}, image ${globalImgIndex}:`, imgErr)
          globalImgIndex++
        }
      }
    } catch (pageErr) {
      console.warn(`Page ${pageNum} operator list error:`, pageErr)
    }
  }

  return { count: mediaPaths.length, mediaPaths }
}

// ---------------------------------------------------------------------------
// DeepSeek AI parsing
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Ты — парсер экзаменационных тестов. Тебе дан текст из PDF-документов.
Верни ТОЛЬКО JSON без комментариев в формате ParsedTest.

Правила:
1. Найди все задачи по номерам (1., 2., Задание 1, Задача 3 и т.д.)
2. Определи тип каждой задачи:
   - single_choice: есть варианты А/Б/В/Г или 1)/2)/3)/4)
   - multiple_choice: "выберите несколько", "отметьте все"
   - numeric: "вычислите", "найдите значение", числовой ответ
   - short_text: короткий текстовый ответ
   - composite: несколько подпунктов а), б), в) или 1), 2), 3)
   - manual_review: развёрнутый ответ, эссе
3. Если в тексте встречается "на рисунке", "по графику", "см. схему" — has_unmatched_images=true
4. Confidence < 0.7 если задача неполная или тип неясен
5. Правильные ответы ищи в тексте после "Ответ:", "Правильный ответ:"
6. НЕ домысливай ответы — если не нашёл, оставь null

Текст документов:
[DOCUMENT_TEXT]

Метаданные изображений:
[IMAGE_METADATA]`

async function parseWithDeepSeek(
  documentsText: string,
  imageMetadata: string,
  apiKey: string
): Promise<ParsedTestResult> {
  const prompt = SYSTEM_PROMPT
    .replace("[DOCUMENT_TEXT]", documentsText)
    .replace("[IMAGE_METADATA]", imageMetadata)

  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 8000,
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown")
    throw new Error(`DeepSeek API error ${response.status}: ${errText}`)
  }

  const data = await response.json()
  const content: string = data.choices?.[0]?.message?.content ?? ""

  if (!content) {
    throw new Error("DeepSeek returned empty response")
  }

  const parsed: ParsedTestResult = JSON.parse(content)
  if (!parsed.meta) parsed.meta = {}
  if (!Array.isArray(parsed.tasks)) parsed.tasks = []
  if (!Array.isArray(parsed.answers)) parsed.answers = []
  if (!Array.isArray(parsed.solutions)) parsed.solutions = []
  if (!Array.isArray(parsed.warnings)) parsed.warnings = []

  return parsed
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  // CORS pre-flight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    })
  }

  const supabase = getAdminClient()
  let jobId: string | undefined

  try {
    const body = await req.json()
    const { job_id, test_version_id, doc_ids } = body as {
      job_id: string
      test_version_id: string
      doc_ids: string[]
    }
    jobId = job_id

    if (!job_id || !test_version_id || !Array.isArray(doc_ids)) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400 })
    }

    const deepseekApiKey = Deno.env.get("DEEPSEEK_API_KEY")
    if (!deepseekApiKey) {
      throw new Error("DEEPSEEK_API_KEY environment variable is not set")
    }

    // -----------------------------------------------------------------------
    // Step 1: Mark job as processing
    // -----------------------------------------------------------------------
    await supabase
      .from("parsing_jobs")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", job_id)

    // -----------------------------------------------------------------------
    // Step 2: Load each document and extract text + images
    // -----------------------------------------------------------------------
    const allPageTexts: ExtractedPageText[] = []
    const allMediaPaths: string[] = []
    const imageMetadataLines: string[] = []

    for (const docId of doc_ids) {
      // Fetch document record to get storage_path and doc_type
      const { data: docRecord, error: docFetchErr } = await supabase
        .from("test_documents")
        .select("id, storage_path, doc_type")
        .eq("id", docId)
        .single()

      if (docFetchErr || !docRecord) {
        console.warn(`Document ${docId} not found, skipping`)
        continue
      }

      // Download PDF from Storage
      const { data: downloadData, error: downloadErr } = await supabase.storage
        .from("test-documents")
        .download(docRecord.storage_path)

      if (downloadErr || !downloadData) {
        console.warn(`Failed to download ${docRecord.storage_path}: ${downloadErr?.message}`)
        await supabase
          .from("test_documents")
          .update({ parse_status: "failed" })
          .eq("id", docId)
        continue
      }

      const pdfBytes = await downloadData.arrayBuffer()

      // --- EXTRACT TEXT ---
      let pages: ExtractedPageText[] = []
      let pageCount = 0

      try {
        const result = await extractTextFromPdf(pdfBytes)
        pages = result.pages
        pageCount = result.pageCount

        await supabase
          .from("test_documents")
          .update({
            extracted_text: pages,
            page_count: pageCount,
            parse_status: "text_extracted",
          })
          .eq("id", docId)

        for (const p of pages) {
          allPageTexts.push({ page: p.page, text: `[Doc:${docRecord.doc_type} Page:${p.page}] ${p.text}` })
        }
      } catch (textErr) {
        console.warn(`Text extraction failed for ${docId}:`, textErr)
        await supabase
          .from("test_documents")
          .update({ parse_status: "text_failed" })
          .eq("id", docId)
      }

      // --- EXTRACT IMAGES (only for tasks and solutions docs) ---
      if (docRecord.doc_type === "tasks" || docRecord.doc_type === "solutions") {
        try {
          const { count, mediaPaths } = await extractImagesFromPdf(
            pdfBytes,
            supabase,
            test_version_id,
            docId
          )

          allMediaPaths.push(...mediaPaths)

          await supabase
            .from("test_documents")
            .update({ extracted_images_count: count })
            .eq("id", docId)

          for (const path of mediaPaths) {
            imageMetadataLines.push(`Path: ${path}`)
          }
        } catch (imgErr) {
          // Image extraction failure is non-fatal — continue with text only
          console.warn(`Image extraction failed for ${docId}, continuing without images:`, imgErr)
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 3: AI parse
    // -----------------------------------------------------------------------
    const documentsText = allPageTexts.map((p) => p.text).join("\n\n")
    const imageMetadata = imageMetadataLines.join("\n") || "Изображения не найдены."

    let parsedResult: ParsedTestResult
    try {
      parsedResult = await parseWithDeepSeek(documentsText, imageMetadata, deepseekApiKey)
    } catch (aiErr) {
      throw new Error(`AI parsing failed: ${aiErr instanceof Error ? aiErr.message : String(aiErr)}`)
    }

    // -----------------------------------------------------------------------
    // Step 4: Save tasks, answer keys, solutions, match images
    // -----------------------------------------------------------------------

    // Build answer map keyed by task number
    const answerMap = new Map<number, ParsedAnswer>()
    for (const answer of parsedResult.answers) {
      answerMap.set(answer.task_number, answer)
    }

    // Build solution map keyed by task number
    const solutionMap = new Map<number, ParsedSolution>()
    for (const sol of parsedResult.solutions) {
      solutionMap.set(sol.task_number, sol)
    }

    let tasksInserted = 0
    let answersMatched = 0
    let solutionsMatched = 0
    const insertedTaskMap = new Map<number, string>() // task_number → task.id

    for (const parsedTask of parsedResult.tasks) {
      const { data: task, error: taskErr } = await supabase
        .from("test_tasks")
        .insert({
          test_version_id,
          task_number: parsedTask.number,
          sort_order: parsedTask.number,
          prompt_text: parsedTask.prompt_text,
          task_type: parsedTask.task_type_guess,
          options: parsedTask.options ?? null,
          answer_parts: parsedTask.answer_parts ?? null,
          answer_format_hint: parsedTask.answer_format_hint ?? null,
          parse_confidence: parsedTask.confidence,
          has_images: parsedTask.image_refs.length > 0 || parsedTask.has_unmatched_images,
          source_pages: parsedTask.source_pages,
          review_status: "pending",
          max_score: 1,
        })
        .select("id")
        .single()

      if (taskErr || !task) {
        console.warn(`Failed to insert task ${parsedTask.number}:`, taskErr?.message)
        continue
      }

      insertedTaskMap.set(parsedTask.number, task.id)
      tasksInserted++

      // Insert answer key if available
      const answer = answerMap.get(parsedTask.number)
      if (answer) {
        const { error: answerErr } = await supabase.from("task_answer_keys").insert({
          task_id: task.id,
          correct_answer: answer.correct_answer,
          grading_method: answer.grading_method_guess,
          parse_confidence: answer.confidence,
        })
        if (!answerErr) answersMatched++
      }

      // Insert solution if available
      const solution = solutionMap.get(parsedTask.number)
      if (solution) {
        const { error: solErr } = await supabase.from("task_solutions").insert({
          task_id: task.id,
          solution_text: solution.solution_text,
        })
        if (!solErr) solutionsMatched++
      }
    }

    // Match images to tasks via image_refs
    let imagesAttached = 0
    for (const parsedTask of parsedResult.tasks) {
      const taskId = insertedTaskMap.get(parsedTask.number)
      if (!taskId) continue

      for (const ref of parsedTask.image_refs) {
        // Find task_media record by storage_path matching the ref
        const { data: mediaRecord } = await supabase
          .from("task_media")
          .select("id")
          .eq("storage_path", ref)
          .is("task_id", null)
          .limit(1)
          .single()

        if (mediaRecord) {
          await supabase
            .from("task_media")
            .update({
              task_id: taskId,
              placement: parsedTask.images_placement ?? "above_text",
            })
            .eq("id", mediaRecord.id)

          await supabase
            .from("test_tasks")
            .update({ has_images: true })
            .eq("id", taskId)

          imagesAttached++
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 5: Save parsing warnings
    // -----------------------------------------------------------------------
    for (const warning of parsedResult.warnings) {
      const taskId = warning.task_number
        ? insertedTaskMap.get(warning.task_number)
        : null

      await supabase.from("parsing_warnings").insert({
        parsing_job_id: job_id,
        warning_type: warning.type,
        description: warning.description,
        task_id: taskId ?? null,
        is_resolved: false,
      })
    }

    // -----------------------------------------------------------------------
    // Step 6: Update job as done and test_version as in_review
    // -----------------------------------------------------------------------
    const resultSummary = {
      tasks_found: tasksInserted,
      answers_matched: answersMatched,
      solutions_matched: solutionsMatched,
      images_extracted: allMediaPaths.length,
      images_attached: imagesAttached,
      warnings_count: parsedResult.warnings.length,
    }

    await supabase
      .from("parsing_jobs")
      .update({
        status: "done",
        completed_at: new Date().toISOString(),
        result_summary: resultSummary,
      })
      .eq("id", job_id)

    if (tasksInserted > 0) {
      await supabase
        .from("test_versions")
        .update({ status: "in_review" })
        .eq("id", test_version_id)
    }

    return new Response(JSON.stringify({ success: true, result_summary: resultSummary }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[process-pdf] Fatal error:", message)

    // Update job to failed if we know the job id
    if (jobId) {
      const supabaseForError = getAdminClient()
      await supabaseForError
        .from("parsing_jobs")
        .update({
          status: "failed",
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .catch(console.error)
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
})
