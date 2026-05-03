// @ts-nocheck — Deno runtime, npm: imports, no TS strict checks needed
import { createClient } from "npm:@supabase/supabase-js@2"

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

interface ParsedTask {
  number: number
  prompt_text: string
  task_type_guess: "single_choice"|"multiple_choice"|"short_text"|"numeric"|"composite"|"manual_review"
  options?: Array<{ id: string; text: string }>
  answer_parts?: Array<{ label: string; type: string }>
  answer_format_hint?: string
  image_refs: string[]
  images_placement: "above_text"|"below_text"|"inline"
  has_unmatched_images: boolean
  source_pages: number[]
  confidence: number
}

interface ParsedAnswer {
  task_number: number
  correct_answer: unknown
  grading_method_guess: "exact"|"normalized"|"numeric_tolerance"|"set_match"|"manual"
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

// -------------------------------------------------------------------------
// Admin client (uses built-in Supabase env vars)
// -------------------------------------------------------------------------

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL")!
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// -------------------------------------------------------------------------
// PDF text extraction — tries pdf-parse (npm), falls back to raw binary
// -------------------------------------------------------------------------

async function extractTextFromPdf(pdfBytes: ArrayBuffer): Promise<{ pages: Array<{page:number;text:string}>; pageCount: number }> {
  const bytes = new Uint8Array(pdfBytes)

  // Strategy 1: pdf-parse (npm, Node.js-compatible, works in Deno)
  try {
    const pdfParse = (await import("npm:pdf-parse/lib/pdf-parse.js")).default
    const { Buffer } = await import("node:buffer")
    const buf = Buffer.from(bytes)
    const result = await pdfParse(buf)
    const text: string = result.text ?? ""
    console.log(`[pdf-parse] extracted ${text.length} chars, ${result.numpages} pages`)
    if (text.trim().length > 0) {
      // Split by page breaks if available, otherwise treat as single page
      const pages = text.split(/\f/).map((pageText, i) => ({
        page: i + 1,
        text: pageText.replace(/\s+/g, " ").trim(),
      })).filter(p => p.text.length > 0)
      return { pages, pageCount: result.numpages }
    }
  } catch (e) {
    console.warn("[pdf-parse] failed:", e instanceof Error ? e.message : String(e))
  }

  // Strategy 2: raw binary text extraction (works for text-based PDFs)
  try {
    const decoder = new TextDecoder("latin1")
    const pdfStr = decoder.decode(bytes)
    const texts: string[] = []

    // Extract text between parentheses in BT/ET blocks (PDF text operators)
    const btEtRegex = /BT\s*([\s\S]*?)\s*ET/g
    let match
    while ((match = btEtRegex.exec(pdfStr)) !== null) {
      const block = match[1]
      const tjRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*(?:Tj|'|")/g
      let tjMatch
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        const txt = tjMatch[1]
          .replace(/\\n/g, "\n").replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t").replace(/\\\\/g, "\\")
          .replace(/\\([()])/g, "$1")
        if (txt.trim()) texts.push(txt)
      }
    }

    const rawText = texts.join(" ").replace(/\s+/g, " ").trim()
    console.log(`[raw-extract] extracted ${rawText.length} chars`)
    if (rawText.length > 50) {
      return { pages: [{ page: 1, text: rawText }], pageCount: 1 }
    }
  } catch (e) {
    console.warn("[raw-extract] failed:", e instanceof Error ? e.message : String(e))
  }

  console.warn("[text-extraction] both strategies failed — no text extracted")
  return { pages: [], pageCount: 0 }
}

// -------------------------------------------------------------------------
// DeepSeek AI parsing
// -------------------------------------------------------------------------

const SYSTEM_PROMPT = `Ты — парсер экзаменационных тестов. Тебе дан текст из PDF-документов.
Верни ТОЛЬКО валидный JSON без комментариев и без markdown.

Правила:
1. Найди все задачи по номерам (1., 2., Задание 1, Задача 3 и т.д.)
2. Определи тип каждой задачи:
   - single_choice: есть варианты А/Б/В/Г или 1)/2)/3)/4)
   - multiple_choice: "выберите несколько", "отметьте все"
   - numeric: "вычислите", "найдите значение", числовой ответ
   - short_text: короткий текстовый ответ
   - composite: несколько подпунктов а), б), в)
   - manual_review: развёрнутый ответ, эссе
3. Если в тексте встречается "на рисунке", "по графику", "см. схему" — has_unmatched_images=true
4. confidence < 0.7 если задача неполная или тип неясен
5. Правильные ответы ищи после "Ответ:", "Правильный ответ:", "Ключ:"
6. НЕ домысливай ответы — если не нашёл, оставь null
7. Ответ должен быть строго в JSON формате ниже:

{
  "meta": {"title": "...", "subject": "...", "exam_type": "...", "grade": "..."},
  "tasks": [{"number": 1, "prompt_text": "...", "task_type_guess": "short_text", "options": [], "answer_parts": [], "answer_format_hint": null, "image_refs": [], "images_placement": "above_text", "has_unmatched_images": false, "source_pages": [1], "confidence": 0.9}],
  "answers": [{"task_number": 1, "correct_answer": "...", "grading_method_guess": "exact", "confidence": 0.9}],
  "solutions": [],
  "warnings": []
}

Текст документов:
[DOCUMENT_TEXT]`

async function parseWithDeepSeek(documentsText: string, apiKey: string): Promise<ParsedTestResult> {
  const prompt = SYSTEM_PROMPT.replace("[DOCUMENT_TEXT]", documentsText.slice(0, 30000))

  console.log(`[deepseek] sending ${documentsText.length} chars of text`)

  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
  console.log(`[deepseek] response length: ${content.length}`)

  if (!content) throw new Error("DeepSeek returned empty response")

  const parsed: ParsedTestResult = JSON.parse(content)
  if (!parsed.meta) parsed.meta = {}
  if (!Array.isArray(parsed.tasks)) parsed.tasks = []
  if (!Array.isArray(parsed.answers)) parsed.answers = []
  if (!Array.isArray(parsed.solutions)) parsed.solutions = []
  if (!Array.isArray(parsed.warnings)) parsed.warnings = []

  console.log(`[deepseek] parsed ${parsed.tasks.length} tasks, ${parsed.answers.length} answers`)
  return parsed
}

// -------------------------------------------------------------------------
// Main handler
// -------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" },
    })
  }

  const supabase = getAdminClient()
  let jobId: string | undefined

  try {
    const body = await req.json()
    const { job_id, test_version_id, doc_ids } = body as { job_id: string; test_version_id: string; doc_ids: string[] }
    jobId = job_id
    console.log(`[process-pdf] job=${job_id}, version=${test_version_id}, docs=${doc_ids?.length}`)

    if (!job_id || !test_version_id || !Array.isArray(doc_ids) || doc_ids.length === 0) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400 })
    }

    const deepseekApiKey = Deno.env.get("DEEPSEEK_API_KEY")
    if (!deepseekApiKey) throw new Error("DEEPSEEK_API_KEY is not set in Supabase Edge Function Secrets.")

    // Step 1: Mark job as processing
    const { error: jobUpdateErr } = await supabase
      .from("parsing_jobs")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", job_id)
    if (jobUpdateErr) console.error("[step1] job update error:", jobUpdateErr.message)

    // Step 2: Download and extract text from each document
    const allPageTexts: Array<{ page: number; text: string }> = []

    for (const docId of doc_ids) {
      console.log(`[step2] processing doc=${docId}`)

      const { data: docRecord, error: docErr } = await supabase
        .from("test_documents")
        .select("id, storage_path, doc_type")
        .eq("id", docId)
        .single()

      if (docErr || !docRecord) {
        console.error(`[step2] doc not found: ${docId}`, docErr?.message)
        continue
      }

      console.log(`[step2] downloading ${docRecord.storage_path}`)
      const { data: downloadData, error: downloadErr } = await supabase.storage
        .from("test-documents")
        .download(docRecord.storage_path)

      if (downloadErr || !downloadData) {
        console.error(`[step2] download failed for ${docRecord.storage_path}:`, downloadErr?.message)
        await supabase.from("test_documents").update({ parse_status: "failed" }).eq("id", docId)
        continue
      }

      const pdfBytes = await downloadData.arrayBuffer()
      console.log(`[step2] downloaded ${pdfBytes.byteLength} bytes`)

      const { pages, pageCount } = await extractTextFromPdf(pdfBytes)
      console.log(`[step2] extracted ${pages.length} pages, ${pageCount} total`)

      if (pages.length > 0) {
        const { error: updateErr } = await supabase.from("test_documents").update({
          extracted_text: pages,
          page_count: pageCount,
          parse_status: "text_extracted",
        }).eq("id", docId)
        if (updateErr) console.error(`[step2] DB update error for ${docId}:`, updateErr.message)

        for (const p of pages) {
          allPageTexts.push({ page: p.page, text: `[Doc:${docRecord.doc_type} Page:${p.page}] ${p.text}` })
        }
      } else {
        const { error: updateErr } = await supabase.from("test_documents").update({
          parse_status: "text_failed",
          page_count: pageCount,
        }).eq("id", docId)
        if (updateErr) console.error(`[step2] text_failed update error for ${docId}:`, updateErr.message)
      }
    }

    // Step 3: Call DeepSeek
    const documentsText = allPageTexts.map(p => p.text).join("\n\n")
    if (!documentsText.trim()) {
      throw new Error("No text could be extracted from the uploaded PDFs. Make sure the PDF contains selectable text (not a scan).")
    }

    const parsedResult = await parseWithDeepSeek(documentsText, deepseekApiKey)

    // Step 4: Save tasks, answers, solutions
    const answerMap = new Map<number, ParsedAnswer>()
    for (const a of parsedResult.answers) answerMap.set(a.task_number, a)
    const solutionMap = new Map<number, ParsedSolution>()
    for (const s of parsedResult.solutions) solutionMap.set(s.task_number, s)

    let tasksInserted = 0, answersMatched = 0, solutionsMatched = 0
    const insertedTaskMap = new Map<number, string>()

    for (const parsedTask of parsedResult.tasks) {
      const { data: task, error: taskErr } = await supabase.from("test_tasks").insert({
        test_version_id,
        task_number: parsedTask.number,
        sort_order: parsedTask.number,
        prompt_text: parsedTask.prompt_text,
        task_type: parsedTask.task_type_guess,
        options: parsedTask.options?.length ? parsedTask.options : null,
        answer_parts: parsedTask.answer_parts?.length ? parsedTask.answer_parts : null,
        answer_format_hint: parsedTask.answer_format_hint ?? null,
        parse_confidence: parsedTask.confidence,
        has_images: parsedTask.has_unmatched_images,
        source_pages: parsedTask.source_pages,
        review_status: "pending",
        max_score: 1,
      }).select("id").single()

      if (taskErr || !task) { console.warn(`[step4] task insert error:`, taskErr?.message); continue }
      insertedTaskMap.set(parsedTask.number, task.id)
      tasksInserted++

      const answer = answerMap.get(parsedTask.number)
      if (answer) {
        const { error: ae } = await supabase.from("task_answer_keys").insert({
          task_id: task.id,
          correct_answer: answer.correct_answer,
          grading_method: answer.grading_method_guess,
          parse_confidence: answer.confidence,
        })
        if (!ae) answersMatched++
      }

      const solution = solutionMap.get(parsedTask.number)
      if (solution) {
        const { error: se } = await supabase.from("task_solutions").insert({
          task_id: task.id,
          solution_text: solution.solution_text,
        })
        if (!se) solutionsMatched++
      }
    }

    // Step 5: Save warnings
    for (const warning of parsedResult.warnings) {
      const taskId = warning.task_number ? insertedTaskMap.get(warning.task_number) : null
      await supabase.from("parsing_warnings").insert({
        parsing_job_id: job_id,
        warning_type: warning.type,
        description: warning.description,
        task_id: taskId ?? null,
        is_resolved: false,
      })
    }

    // Step 6: Finalize
    const resultSummary = {
      tasks_found: tasksInserted,
      answers_matched: answersMatched,
      solutions_matched: solutionsMatched,
      images_extracted: 0,
      images_attached: 0,
      warnings_count: parsedResult.warnings.length,
    }

    await supabase.from("parsing_jobs").update({
      status: "done",
      completed_at: new Date().toISOString(),
      result_summary: resultSummary,
    }).eq("id", job_id)

    if (tasksInserted > 0) {
      await supabase.from("test_versions").update({ status: "in_review" }).eq("id", test_version_id)
    }

    console.log(`[process-pdf] done: ${tasksInserted} tasks`)
    return new Response(JSON.stringify({ success: true, result_summary: resultSummary }), {
      headers: { "Content-Type": "application/json" },
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[process-pdf] Fatal error:", message)

    if (jobId) {
      await getAdminClient()
        .from("parsing_jobs")
        .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
        .eq("id", jobId)
        .catch(e => console.error("[process-pdf] failed to update job status:", e))
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
})
