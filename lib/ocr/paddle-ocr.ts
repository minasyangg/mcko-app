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

// Защита от аномально больших загрузок (память/время serverless-функции —
// сам файл целиком буферизуется перед отправкой). Обычный скан экзамена на
// 10-20 страниц укладывается в единицы МБ; 40 МБ — щедрый запас.
const MAX_FILE_SIZE_BYTES = 40 * 1024 * 1024

const SUBMIT_TIMEOUT_MS = 30_000
const STATUS_TIMEOUT_MS = 10_000
const RESULT_TIMEOUT_MS = 30_000

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

// Тело ответа от PaddleOCR в сообщение исключения не подмешиваем — оно
// уходит пользователю (parsing_jobs.error_message → UI учителя), а внешний
// API в теле ошибки не обязан ничего скрывать намеренно (заголовки запроса,
// внутренние детали). Полный текст — только в серверный лог.
function throwSanitized(context: string, status: number, rawBody: string): never {
  console.error(`[paddle-ocr] ${context} failed: HTTP ${status}: ${rawBody.slice(0, 500)}`)
  throw new Error(`Ошибка сервиса распознавания документов (${context}, код ${status}). Попробуйте ещё раз позже.`)
}

// Ставит документ на распознавание, сразу возвращает jobId (не ждёт результата).
export async function submitPaddleOcrJob(fileBuffer: Buffer, filename: string): Promise<string> {
  if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(`Файл слишком большой (${Math.round(fileBuffer.length / 1024 / 1024)} МБ, максимум ${MAX_FILE_SIZE_BYTES / 1024 / 1024} МБ).`)
  }

  const form = new FormData()
  form.set('model', MODEL)
  form.set('optionalPayload', JSON.stringify(OPTIONAL_PAYLOAD))
  form.set('file', new Blob([new Uint8Array(fileBuffer)]), filename)

  const res = await fetch(JOB_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
    signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
  })
  if (!res.ok) throwSanitized('отправка документа', res.status, await res.text().catch(() => ''))

  const json = await res.json()
  const jobId = json?.data?.jobId
  if (!jobId) {
    console.error('[paddle-ocr] submit: no jobId in response', JSON.stringify(json).slice(0, 500))
    throw new Error('Сервис распознавания не вернул идентификатор задачи.')
  }
  return jobId
}

// Разовая проверка статуса job'а — дешёвый GET, безопасно дёргать на каждый
// опрос статуса фронтендом.
export async function getPaddleOcrJobStatus(jobId: string): Promise<PaddleJobStatus> {
  const res = await fetch(`${JOB_URL}/${jobId}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  })
  if (!res.ok) throwSanitized('проверка статуса', res.status, await res.text().catch(() => ''))

  const json = await res.json()
  return json?.data
}

// Скачивает готовый JSONL-результат и разворачивает в плоский массив
// страниц — одна строка JSONL может содержать несколько layoutParsingResults
// (страниц).
export async function fetchPaddleOcrPages(jsonlUrl: string): Promise<PaddlePage[]> {
  const res = await fetch(jsonlUrl, { signal: AbortSignal.timeout(RESULT_TIMEOUT_MS) })
  if (!res.ok) throwSanitized('загрузка результата', res.status, await res.text().catch(() => ''))
  const text = await res.text()

  const pages: PaddlePage[] = []
  for (const line of text.trim().split('\n')) {
    if (!line.trim()) continue
    let result: any
    try {
      result = JSON.parse(line)?.result
    } catch (e) {
      console.warn('[paddle-ocr] skipping malformed result line:', (e as Error).message)
      continue
    }
    const layoutResults = result?.layoutParsingResults
    if (!Array.isArray(layoutResults)) continue
    for (const item of layoutResults) {
      pages.push({ prunedResult: item.prunedResult, inputImage: item.inputImage })
    }
  }
  return pages
}
