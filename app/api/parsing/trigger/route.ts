import { after } from 'next/server'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// pdf-parse 1.1.1 is CJS-only
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse: (buf: Buffer, options?: object) => Promise<{ text: string; numpages: number }> = require('pdf-parse')

interface UploadInfo {
  docType: 'tasks' | 'answers' | 'solutions'
  storagePath: string
  originalFilename: string
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

const DEEPSEEK_PROMPT = `Ты парсер экзаменационных тестов. Дан текст PDF-документа.
Верни ТОЛЬКО валидный JSON без markdown и пояснений.

Найди все задачи по номерам (1., 2., Задание 1, Задача 3 и т.д.).
Типы задач: single_choice, multiple_choice, short_text, numeric, composite, manual_review.
Правильные ответы ищи после "Ответ:", "Правильный ответ:".
Если встречается "на рисунке", "по графику", "см. схему" — has_unmatched_images=true.
НЕ придумывай ответы — если не нашёл, оставь null.

JSON схема:
{"meta":{"title":"","subject":"","exam_type":"","grade":""},"tasks":[{"number":1,"prompt_text":"...","task_type_guess":"short_text","options":[],"answer_parts":[],"answer_format_hint":null,"image_refs":[],"images_placement":"above_text","has_unmatched_images":false,"source_pages":[1],"confidence":0.9}],"answers":[{"task_number":1,"correct_answer":"...","grading_method_guess":"exact","confidence":0.9}],"solutions":[],"warnings":[]}

Текст:
[TEXT]`

// ─── PDF text extraction ─────────────────────────────────────────────────────

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(buffer)
    const text = data.text?.trim() ?? ''
    console.log(`[pdf-parse] ${text.length} chars, ${data.numpages} pages`)
    return text
  } catch (e) {
    console.error('[pdf-parse] error:', e)
    return ''
  }
}

// ─── Image extraction ────────────────────────────────────────────────────────

interface ExtractedImage {
  data: Buffer
  format: 'jpeg' | 'png' | 'rgba' | 'rgb' | 'grayscale'
  index: number
  width?: number
  height?: number
  channels?: number  // 1=grayscale, 3=rgb, 4=rgba — only set for raw pixel data from pdfjs
}

// pdfjs-based extraction — handles FlateDecode and all compressed image streams
async function extractImagesWithPdfjs(pdfBuffer: Buffer): Promise<ExtractedImage[]> {
  try {
    const { pathToFileURL } = await import('url')
    const { join } = await import('path')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
    // process.cwd() = project root at runtime (works on Vercel too: /var/task)
    const workerPath = join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')
    pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href

    const { OPS, ImageKind } = pdfjsLib

    const pdfDoc = await pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      disableFontFace: true,
      verbosity: 0,
    }).promise

    const images: ExtractedImage[] = []

    // Helper: page.objs.get() is async — the worker sends image data via a separate
    // message channel AFTER getOperatorList() resolves. Always use the callback form.
    function getObjAsync(objs: any, name: string): Promise<any> {
      return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error(`timeout waiting for obj: ${name}`)), 10000)
        objs.get(name, (data: any) => { clearTimeout(t); res(data) })
      })
    }

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum)
      try {
        const ops = await page.getOperatorList()
        const seenNames = new Set<string>()
        for (let i = 0; i < ops.fnArray.length; i++) {
          if (ops.fnArray[i] === OPS.paintImageXObject) {
            seenNames.add(String(ops.argsArray[i][0]))
          }
        }
        for (const name of seenNames) {
          try {
            // FIX 1: use callback form — synchronous get() throws if obj not yet resolved
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const img: any = await getObjAsync(page.objs, name)
            if (!img?.data || img.width <= 0 || img.height <= 0) continue
            if (img.width < 32 || img.height < 32) continue

            // FIX 2: Buffer.from(img.data) — NOT Buffer.from(img.data.buffer)
            // img.data is a TypedArray view; its .buffer may be larger than the view
            // due to memory alignment (e.g. 31212-byte view in a 41616-byte ArrayBuffer).
            const rawBuf = Buffer.from(img.data)

            // FIX 3: derive channels from img.kind (ImageKind exported by pdfjs-dist).
            // Most PDFs use RGB_24BPP (kind=2, channels=3). Hardcoding channels:4
            // causes sharp to crash with "memory area too small" for RGB images.
            const channels: number =
              img.kind === ImageKind.RGBA_32BPP ? 4
              : img.kind === ImageKind.RGB_24BPP ? 3
              : 1  // GRAYSCALE_1BPP

            images.push({
              data: rawBuf,
              format: channels === 4 ? 'rgba' : channels === 3 ? 'rgb' : 'grayscale',
              index: images.length,
              width: img.width,
              height: img.height,
              channels,
            })
          } catch (e) {
            console.warn(`[pdfjs] page ${pageNum} obj ${name} error:`, (e as Error).message)
          }
        }
      } catch (e) {
        console.warn(`[pdfjs] page ${pageNum} error:`, e)
      } finally {
        page.cleanup()
      }
    }

    await pdfDoc.destroy()
    console.log(`[pdfjs] extracted ${images.length} images`)
    return images
  } catch (e) {
    console.error('[pdfjs] extraction failed:', e)
    return []
  }
}

// Raw binary fallback — finds uncompressed JPEG/PNG embedded directly in PDF bytes
function extractRawImages(pdfBytes: Buffer): ExtractedImage[] {
  const images: ExtractedImage[] = []
  let pos = 0
  const buf = pdfBytes

  while (pos < buf.length - 4) {
    if (buf[pos] === 0xFF && buf[pos + 1] === 0xD8 && buf[pos + 2] === 0xFF) {
      let end = pos + 3
      let found = false
      while (end < buf.length - 1) {
        if (buf[end] === 0xFF && buf[end + 1] === 0xD9) { end += 2; found = true; break }
        end++
      }
      if (found) {
        const img = buf.slice(pos, end)
        if (img.length > 2048) images.push({ data: img, format: 'jpeg', index: images.length })
        pos = end; continue
      }
    }
    if (buf[pos] === 0x89 && buf[pos + 1] === 0x50 && buf[pos + 2] === 0x4E && buf[pos + 3] === 0x47) {
      const iend = Buffer.from([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82])
      const idx = buf.indexOf(iend, pos + 8)
      if (idx !== -1) {
        const end = idx + 8
        const img = buf.slice(pos, end)
        if (img.length > 2048) images.push({ data: img, format: 'png', index: images.length })
        pos = end; continue
      }
    }
    pos++
  }

  return images
}

// ─── Upload images to task-media ─────────────────────────────────────────────

async function uploadImages(
  client: SupabaseClient<Database>,
  pdfBuffer: Buffer,
  testVersionId: string
): Promise<number> {
  let sharp: typeof import('sharp')
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sharp = require('sharp')
  } catch {
    console.warn('[images] sharp not available')
    return 0
  }

  // pdfjs handles FlateDecode (most school PDFs); fall back to raw binary scan for uncompressed JPEG/PNG
  let images = await extractImagesWithPdfjs(pdfBuffer)
  if (images.length === 0) {
    console.log('[images] pdfjs found nothing, trying raw binary scan')
    images = extractRawImages(pdfBuffer)
  }

  if (images.length === 0) {
    console.log('[images] no embedded images found')
    return 0
  }

  console.log(`[images] processing ${images.length} images`)
  let uploaded = 0

  for (const img of images) {
    try {
      const isRawPixels = img.format === 'rgba' || img.format === 'rgb' || img.format === 'grayscale'
      const sharpInput = isRawPixels
        ? sharp(img.data, { raw: { width: img.width!, height: img.height!, channels: (img.channels ?? 4) as 1 | 2 | 3 | 4 } })
        : sharp(img.data)

      const webpBuf = await sharpInput
        .resize({ width: 1200, withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer()

      const storagePath = `task-media/${testVersionId}/pdf_${img.index}.webp`

      const { error: upErr } = await client.storage
        .from('task-media')
        .upload(storagePath, webpBuf, { contentType: 'image/webp', upsert: true })

      if (upErr) {
        console.error(`[images] upload error for img_${img.index}:`, upErr.message)
        continue
      }

      // For jpeg/png encoded bytes, read dimensions from sharp after converting.
      // For raw pixel data (rgba/rgb/grayscale) width/height are already known from pdfjs.
      let widthPx = img.width ?? null
      let heightPx = img.height ?? null
      if (img.format === 'jpeg' || img.format === 'png') {
        const meta = await sharp(img.data).metadata()
        widthPx = meta.width ?? null
        heightPx = meta.height ?? null
      }

      await client.from('task_media').insert({
        task_id: null,
        storage_path: storagePath,
        media_type: 'image',
        format: 'webp',
        width_px: widthPx,
        height_px: heightPx,
        file_size_bytes: webpBuf.length,
        is_manually_uploaded: false,
        placement: 'above_text',
        sort_order: img.index,
      })

      uploaded++
    } catch (e) {
      console.error(`[images] error processing img_${img.index}:`, e)
    }
  }

  console.log(`[images] uploaded ${uploaded}/${images.length}`)
  return uploaded
}

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

// ─── DeepSeek ─────────────────────────────────────────────────────────────────

async function callDeepSeek(text: string): Promise<any> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set in environment variables')

  const prompt = DEEPSEEK_PROMPT.replace('[TEXT]', text.slice(0, 28000))
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 8000,
    }),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`DeepSeek error ${res.status}: ${err.slice(0, 300)}`)
  }
  const json = await res.json()
  const content = json.choices?.[0]?.message?.content
  if (!content) throw new Error('DeepSeek returned empty content')
  return JSON.parse(content)
}

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

// ─── PaddleOCR JSON parser ────────────────────────────────────────────────────

interface PaddleBlock {
  block_label: string
  block_content: string
  block_bbox: [number, number, number, number]
  block_id: number
  block_order?: number
}

interface PaddlePage {
  prunedResult: { parsing_res_list: PaddleBlock[] }
  inputImage: Record<string, string>
}

interface JsonImageRef {
  pageImgUrl: string
  bbox: [number, number, number, number]
  blockId: number
  sortOrder: number
}

interface JsonTaskRaw {
  number: number
  conditionParts: string[]
  solutionParts: string[]
  answer: string | null
  conditionImageRefs: JsonImageRef[]  // shown in task (condition)
  solutionImageRefs: JsonImageRef[]   // shown only in solution (on student request)
}

function parseJsonPaddleOCR(pages: PaddlePage[]): {
  meta: Record<string, string>
  tasks: any[]
  answers: any[]
  solutions: any[]
  warnings: any[]
  rawTasks: JsonTaskRaw[]
} {
  const SKIP = new Set(['header', 'footer', 'number', 'header_image', 'footer_image'])
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

        // Answer line
        const answerMatch = c.match(/^Ответ[:\s]*(.+)/)
        if (answerMatch && !inSolution) {
          // It's in the solution block but label is "text" (Ответ comes after Решение)
        }
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
  client: SupabaseClient<Database>
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
  client: SupabaseClient<Database>
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

// ─── Apply scoring rules ──────────────────────────────────────────────────────

export async function applyMatchingScoringRules(
  client: SupabaseClient<Database>,
  testVersionId: string
): Promise<number> {
  const { data: version } = await client
    .from('test_versions')
    .select('test_id')
    .eq('id', testVersionId)
    .single()
  if (!version?.test_id) return 0

  const { data: test } = await client
    .from('tests')
    .select('organization_id, exam_type, grade, subject')
    .eq('id', version.test_id)
    .single()
  if (!test?.organization_id) return 0

  const { data: rules } = await client
    .from('scoring_rules')
    .select('id, exam_type, grade, subject, scoring_rule_items ( task_number, max_score )')
    .eq('organization_id', test.organization_id)
  if (!rules?.length) return 0

  // Normalize for case-insensitive, trim-insensitive comparison
  const norm = (s: string | null) => s?.trim().toLowerCase() ?? null

  // Pick the most specific matching rule (null field = wildcard, non-null must match exactly)
  let bestRule: typeof rules[0] | null = null
  let bestScore = -1

  for (const rule of rules) {
    let score = 0
    let mismatch = false

    if (rule.exam_type !== null) {
      if (norm(rule.exam_type) === norm(test.exam_type)) score++
      else { mismatch = true }
    }
    if (rule.grade !== null) {
      if (norm(rule.grade) === norm(test.grade)) score++
      else { mismatch = true }
    }
    if (rule.subject !== null) {
      if (norm(rule.subject) === norm(test.subject)) score++
      else { mismatch = true }
    }

    if (!mismatch && score > bestScore) {
      bestScore = score
      bestRule = rule
    }
  }

  if (!bestRule) { console.log('[scoring-rules] no matching rule found'); return 0 }

  const items = (bestRule as any).scoring_rule_items as { task_number: number; max_score: number }[]
  if (!items?.length) return 0

  let updated = 0
  for (const item of items) {
    const { error } = await client
      .from('test_tasks')
      .update({ max_score: item.max_score })
      .eq('test_version_id', testVersionId)
      .eq('task_number', item.task_number)
    if (!error) updated++
  }

  console.log(`[scoring-rules] rule matched (score=${bestScore}), ${updated}/${items.length} tasks updated`)
  return updated
}

// ─── Answer classification helpers ──────────────────────────────────────────

// Keywords in task text that require free-text explanation → always manual/AI grading
const EXPLANATION_KEYWORDS = /поясни|объясни|докажи|обоснуй|опиши|сформулируй|охарактеризуй|сравни|проанализируй|ответ\s+поясните|ответ\s+объясните/i

export function requiresExplanation(promptText: string): boolean {
  return EXPLANATION_KEYWORDS.test(promptText)
}

function cleanParsedAnswer(raw: string): string {
  return raw.trim()
    .replace(/[.;:]+$/, '')
    .replace(/([-–−])\s+(\d)/g, '$1$2') // "- 7" → "-7"
    .trim()
}

function detectGradingMethod(rawAnswer: string): string {
  const cleaned = cleanParsedAnswer(rawAnswer).trim()
  const lower = cleaned.toLowerCase()

  // Image-based → manual
  if (/см\.?\s*рис|по\s+рисунку|на\s+рисунке|на\s+графике/.test(lower)) return 'manual'
  // Multi-part "1) ... 2) ..." → manual
  if (/\d+\)[\s\S]+\d+\)/.test(cleaned)) return 'manual'
  // LaTeX formula → manual
  if (cleaned.startsWith('$') || /\\frac|\\sqrt/.test(cleaned)) return 'manual'

  // Strip "или" alternatives for detection
  const firstAlt = cleaned.split(/\s+или\s+/i)[0].trim()

  // Letter-digit correspondence "А-3, Б-1" → sequence
  if (/^[А-Еа-е]-\d/.test(firstAlt)) return 'sequence'

  // Pure numeric (int/decimal, optional negative, optional units after space)
  if (/^[-–−]?\d+([,.]?\d+)?(\s+[а-яa-zёА-ЯA-Z\/²³°%·]+\.?)*$/.test(firstAlt)) {
    return 'numeric_tolerance'
  }

  // Digit sequence 2-6 digits (multiple choice items concatenated, e.g. "124", "35")
  if (/^\d{2,6}$/.test(cleaned) && !cleaned.startsWith('0')) return 'set_match'

  // Comma-separated small numbers "1, 4" "2,4,5" → set_match
  if (/^\d+(,\s*\d+)+$/.test(cleaned)) return 'set_match'

  return 'normalized'
}

function buildFormatHint(rawAnswer: string, method: string): string | null {
  const cleaned = cleanParsedAnswer(rawAnswer)
  switch (method) {
    case 'numeric_tolerance':
      if (/[,.]/.test(cleaned.replace(/\s.*$/, ''))) {
        return 'Запишите число через точку или запятую, например: 4.5 (можно и 4,5)'
      }
      return 'Запишите целое число, например: 42'
    case 'sequence':
      return 'Запишите цифры подряд по порядку букв (А, Б, В…), например: 312'
    case 'set_match':
      return 'Запишите номера правильных ответов подряд без пробелов, например: 124'
    default:
      return null
  }
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

// Delete all source documents from test-documents bucket after successful parsing.
// The original files are no longer needed once tasks are extracted into the DB.
async function cleanupSourceDocuments(
  client: SupabaseClient<Database>,
  testVersionId: string
): Promise<void> {
  try {
    const { data: docs } = await client
      .from('test_documents')
      .select('storage_path')
      .eq('test_version_id', testVersionId)
    const paths = (docs ?? []).map((d) => d.storage_path).filter(Boolean)
    if (paths.length > 0) {
      await client.storage.from('test-documents').remove(paths)
      console.log(`[parsing] deleted ${paths.length} source document(s) from storage`)
    }
  } catch (err) {
    // Non-fatal: log but don't fail the job
    console.warn('[parsing] cleanupSourceDocuments failed:', err)
  }
}

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
      await mark('Downloading JSON file')
      const { data: blob, error: dlErr } = await client.storage.from('test-documents').download(jsonDoc.storage_path)
      if (dlErr || !blob) throw new Error(`Failed to download JSON file: ${dlErr?.message}`)

      await client.from('test_documents').update({ parse_status: 'text_extracted' }).eq('id', jsonDoc.id)

      const jsonText = await blob.text()
      await mark('Parsing PaddleOCR JSON')
      const pages: PaddlePage[] = JSON.parse(jsonText)
      const { tasks: parsedTasks, answers: parsedAnswers, solutions: parsedSolutions, rawTasks } = parseJsonPaddleOCR(pages)
      tasks = parsedTasks
      answers = parsedAnswers
      solutions = parsedSolutions

      // Insert tasks FIRST to get task_ids, then upload images directly attached
      await mark(`Saving ${tasks.length} tasks with images`)

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
          grading_method: needsExplanation ? 'manual' : 'exact',
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
          // Get the solution_id just inserted
          const { data: solRow } = await client
            .from('task_solutions').select('id').eq('task_id', task.id).single()
          if (solRow) {
            await uploadJsonSolutionImages(raw.solutionImageRefs, solRow.id, t.number, testVersionId, client)
          }
        }
      }

      imagesExtracted = totalImgs
      imagesAttached = totalImgs // All images are directly attached — no matching needed

      await applyMatchingScoringRules(client, testVersionId)

      await client.from('parsing_jobs').update({
        status: 'done',
        error_message: null,
        completed_at: new Date().toISOString(),
        result_summary: { tasks_found: inserted, answers_matched: matchedAns, solutions_matched: matchedSol, images_extracted: totalImgs, images_attached: totalImgs, warnings_count: 0 },
      }).eq('id', jobId)

      if (inserted > 0) await client.from('test_versions').update({ status: 'in_review' }).eq('id', testVersionId)
      await cleanupSourceDocuments(client, testVersionId)
      console.log(`[parsing/json] done: ${inserted} tasks, ${totalImgs} images`)
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
      // ── PDF pipeline (original) ───────────────────────────────────────────────
      let combinedText = ''
      let tasksPdfBuffer: Buffer | null = null

      for (const docId of docIds) {
        await mark(`Downloading ${docId}`)
        const { data: doc } = await client.from('test_documents').select('id,storage_path,doc_type').eq('id', docId).single()
        if (!doc) continue

        const { data: blob, error: dlErr } = await client.storage.from('test-documents').download(doc.storage_path)
        if (dlErr || !blob) {
          await client.from('test_documents').update({ parse_status: 'failed' }).eq('id', docId)
          continue
        }

        const buffer = Buffer.from(await blob.arrayBuffer())
        if (doc.doc_type === 'tasks') tasksPdfBuffer = buffer

        await mark(`Extracting text (${doc.doc_type})`)
        const text = await extractPdfText(buffer)

        if (text.length > 20) {
          await client.from('test_documents').update({
            extracted_text: [{ page: 1, text }],
            page_count: 1,
            parse_status: 'text_extracted',
          }).eq('id', docId)
          combinedText += `[${doc.doc_type}]\n${text}\n\n`
        } else {
          await client.from('test_documents').update({ parse_status: 'text_failed' }).eq('id', docId)
        }
      }

      if (!combinedText.trim()) {
        throw new Error('Не удалось извлечь текст из PDF. Используйте PDF с выделяемым текстом (не сканированное изображение).')
      }

      await mark(`AI parsing (${combinedText.length} chars)`)
      const parsed = await callDeepSeek(combinedText)
      tasks = Array.isArray(parsed.tasks) ? parsed.tasks : []
      answers = Array.isArray(parsed.answers) ? parsed.answers : []
      solutions = Array.isArray(parsed.solutions) ? parsed.solutions : []

      if (tasksPdfBuffer) {
        await mark(`Extracting images`)
        imagesExtracted = await uploadImages(client, tasksPdfBuffer, testVersionId)
      }
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
        grading_method: needsExplanation ? 'manual' : 'exact',
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
