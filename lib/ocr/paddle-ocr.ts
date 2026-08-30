// Клиент PaddleOCR-VL (AI Studio, асинхронный job API). Отправляет PDF на
// распознавание и отдаёт результат в формате PaddlePage[] — том же, что и
// у ручного пайплайна книг (см. docs/book-ocr-import-pipeline.md), поэтому
// дальше страницы разбирает тот же модуль parseExamDocument.
//
// Важно: здесь НЕТ блокирующего поллинга. PaddleOCR — это ЕГО СОБСТВЕННАЯ
// очередь job'ов: несколько учителей могут отправить PDF одновременно без
// какой-либо очереди на нашей стороне — submitPaddleOcrJob лишь ставит job
// и сразу возвращает jobId. Статус проверяется отдельно, по одному разу за
// вызов (getPaddleOcrJobStatus) — так это дёшево дергать при каждом опросе
// фронтендом GET /api/parsing/jobs/[id] (см. этот роут: он же и довершает
// импорт, когда job готов). Блокирующий poll внутри одного serverless-
// запроса не годится: PaddleOCR может обрабатывать job дольше, чем
// maxDuration функции, особенно под нагрузкой от нескольких учителей сразу.
import type { PaddlePage } from '@/lib/parsing/exam-parsers/types'

const JOB_URL = 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs'
const MODEL = 'PaddleOCR-VL-1.6'

const OPTIONAL_PAYLOAD = {
  useDocOrientationClassify: false,
  useDocUnwarping: false,
  useChartRecognition: false,
}

export interface PaddleJobStatus {
  state: 'pending' | 'running' | 'done' | 'failed'
  resultUrl?: { jsonUrl?: string }
  errorMsg?: string
  extractProgress?: { totalPages?: number; extractedPages?: number }
}

function authHeaders(): Record<string, string> {
  const token = process.env.PADDLE_OCR_TOKEN
  if (!token) throw new Error('PADDLE_OCR_TOKEN not set in environment variables')
  return { Authorization: `bearer ${token}` }
}

// Ставит документ на распознавание, сразу возвращает jobId (не ждёт результата).
export async function submitPaddleOcrJob(fileBuffer: Buffer, filename: string): Promise<string> {
  const form = new FormData()
  form.set('model', MODEL)
  form.set('optionalPayload', JSON.stringify(OPTIONAL_PAYLOAD))
  form.set('file', new Blob([new Uint8Array(fileBuffer)]), filename)

  const res = await fetch(JOB_URL, { method: 'POST', headers: authHeaders(), body: form })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`PaddleOCR job submit error ${res.status}: ${err.slice(0, 300)}`)
  }
  const json = await res.json()
  const jobId = json?.data?.jobId
  if (!jobId) throw new Error('PaddleOCR: no jobId in response')
  return jobId
}

// Разовая проверка статуса job'а — дешёвый GET, безопасно дёргать на каждый
// опрос статуса фронтендом.
export async function getPaddleOcrJobStatus(jobId: string): Promise<PaddleJobStatus> {
  const res = await fetch(`${JOB_URL}/${jobId}`, { headers: authHeaders() })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`PaddleOCR job status error ${res.status}: ${err.slice(0, 300)}`)
  }
  const json = await res.json()
  return json?.data
}

// Скачивает готовый JSONL-результат и разворачивает в плоский массив
// страниц — одна строка JSONL может содержать несколько layoutParsingResults
// (страниц).
export async function fetchPaddleOcrPages(jsonlUrl: string): Promise<PaddlePage[]> {
  const res = await fetch(jsonlUrl)
  if (!res.ok) throw new Error(`PaddleOCR result download error ${res.status}`)
  const text = await res.text()

  const pages: PaddlePage[] = []
  for (const line of text.trim().split('\n')) {
    if (!line.trim()) continue
    const result = JSON.parse(line)?.result
    const layoutResults = result?.layoutParsingResults
    if (!Array.isArray(layoutResults)) continue
    for (const item of layoutResults) {
      pages.push({ prunedResult: item.prunedResult, inputImage: item.inputImage })
    }
  }
  return pages
}
