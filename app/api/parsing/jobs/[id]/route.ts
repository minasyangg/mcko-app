import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPaddleOcrJobStatus, fetchPaddleOcrPages } from '@/lib/ocr/paddle-ocr'
import { savePaddleOcrResult } from '@/lib/parsing/save-paddle-result'
import type { PaddlePage } from '@/lib/parsing/exam-parsers'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// PDF-ветка импорта теста асинхронна: app/api/parsing/trigger только
// отправляет документы в PaddleOCR и сразу возвращается (см. комментарий
// там же — несколько учителей могут парсить одновременно, свою очередь на
// нашей стороне не городим, PaddleOCR это его job-очередь). Каждый опрос
// статуса фронтендом ЭТИМ роутом дополнительно продвигает job: дёшево
// проверяет состояние в PaddleOCR и, когда всё готово, сам довершает импорт
// (разбор + запись заданий в БД) — поэтому запрос никогда не "висит":
// либо идёт распознавание (видно по error_message), либо уже дописывается.
export const maxDuration = 60

type AdminClient = SupabaseClient<Database>

interface OcrStateDoc {
  docId: string
  filename: string
  ocrJobId: string
  state: 'pending' | 'running' | 'done' | 'failed'
  jsonUrl?: string
  errorMsg?: string
  progress?: string
}

interface OcrState {
  examType: string | null
  docs: OcrStateDoc[]
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['teacher', 'admin'].includes(profile.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Дальше — через admin-клиент: продвижение job'а пишет в parsing_jobs/
    // test_tasks и т.п. от имени системы, а не текущего пользователя.
    const admin = createAdminClient()
    const { data: job, error } = await admin
      .from('parsing_jobs')
      .select('id, test_version_id, status, result_summary, error_message, ocr_state, finalizing_at')
      .eq('id', id)
      .single()

    if (error || !job) {
      return Response.json({ error: 'Job not found' }, { status: 404 })
    }

    if (job.status === 'processing' && job.ocr_state) {
      await advancePaddleOcrJob(admin, {
        id: job.id,
        test_version_id: job.test_version_id,
        ocr_state: job.ocr_state as unknown as OcrState,
        finalizing_at: job.finalizing_at,
      })
      const { data: fresh } = await admin
        .from('parsing_jobs')
        .select('status, result_summary, error_message')
        .eq('id', id)
        .single()
      if (fresh) {
        return Response.json({
          status: fresh.status,
          result_summary: fresh.result_summary,
          error_message: fresh.error_message,
        })
      }
    }

    return Response.json({
      status: job.status,
      result_summary: job.result_summary,
      error_message: job.error_message,
    })
  } catch (err) {
    console.error('[parsing/jobs/[id]]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Проверяет статус ещё не завершённых OCR-job'ов PaddleOCR и, когда все
// готовы, довершает импорт. Идемпотентна и безопасна при конкурентных
// вызовах: сам разбор+запись в БД защищены claim'ом через finalizing_at
// (атомарный UPDATE ... WHERE finalizing_at IS NULL) — при гонке нескольких
// опросов задания запишутся только один раз.
async function advancePaddleOcrJob(
  admin: AdminClient,
  job: { id: string; test_version_id: string; ocr_state: OcrState; finalizing_at: string | null }
): Promise<void> {
  const state = job.ocr_state
  if (!state?.docs?.length) return
  if (job.finalizing_at) return // уже кто-то довершает — не мешаем

  let anyFailed = false

  for (const doc of state.docs) {
    if (doc.state === 'done' || doc.state === 'failed') continue
    try {
      const status = await getPaddleOcrJobStatus(doc.ocrJobId)
      if (status.state === 'done') {
        doc.state = 'done'
        doc.jsonUrl = status.resultUrl?.jsonUrl
      } else if (status.state === 'failed') {
        doc.state = 'failed'
        doc.errorMsg = status.errorMsg ?? 'неизвестная ошибка PaddleOCR'
        anyFailed = true
      } else {
        doc.state = status.state
        const p = status.extractProgress
        doc.progress = p?.totalPages ? `${p.extractedPages ?? 0}/${p.totalPages} стр.` : undefined
      }
    } catch (e) {
      doc.state = 'failed'
      doc.errorMsg = e instanceof Error ? e.message : String(e)
      anyFailed = true
    }
  }

  if (anyFailed) {
    const failedDoc = state.docs.find(d => d.state === 'failed')
    await admin.from('parsing_jobs').update({
      status: 'failed',
      error_message: `Ошибка распознавания PaddleOCR (${failedDoc?.filename}): ${failedDoc?.errorMsg ?? 'неизвестная ошибка'}`,
      completed_at: new Date().toISOString(),
      ocr_state: state as any,
    }).eq('id', job.id)
    return
  }

  const allDone = state.docs.every(d => d.state === 'done')
  if (!allDone) {
    const progress = state.docs
      .map(d => `${d.filename}: ${d.state === 'done' ? 'готово' : d.progress ?? 'в очереди PaddleOCR'}`)
      .join('; ')
    await admin.from('parsing_jobs').update({
      error_message: `Распознавание PDF (PaddleOCR) — ${progress}`,
      ocr_state: state as any,
    }).eq('id', job.id)
    return
  }

  // Все job'ы PaddleOCR готовы — claim на довершение (см. комментарий выше).
  const { data: claimed } = await admin
    .from('parsing_jobs')
    .update({ finalizing_at: new Date().toISOString(), error_message: 'Разбор распознанного текста…', ocr_state: state as any })
    .eq('id', job.id)
    .is('finalizing_at', null)
    .select('id')
  if (!claimed?.length) return // кто-то другой уже начал довершение

  try {
    const allPages: PaddlePage[] = []
    for (const doc of state.docs) {
      if (!doc.jsonUrl) continue
      const pages = await fetchPaddleOcrPages(doc.jsonUrl)
      allPages.push(...pages)
    }
    if (!allPages.length) throw new Error('PaddleOCR не вернул ни одной страницы')

    await savePaddleOcrResult(admin, job.id, job.test_version_id, allPages, state.examType)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[parsing/jobs/[id]] finalize failed:', msg)
    await admin.from('parsing_jobs').update({
      status: 'failed',
      error_message: msg,
      completed_at: new Date().toISOString(),
    }).eq('id', job.id)
  }
}
