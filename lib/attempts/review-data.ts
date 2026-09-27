import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Данные окна проверки попытки (AttemptDrawer). Запросы вынесены сюда из
// компонента без изменений, чтобы выполнять их в двух местах одним кодом:
//  - на сервере, в GET /api/attempts/[id]/review — функции Vercel стоят рядом
//    с БД (dub1), поэтому три последовательные волны запросов стоят единицы мс,
//    а браузер делает один запрос вместо трёх волн через всю Европу;
//  - в браузере — запасной путь, если роут не ответил.
// В обоих случаях клиент Supabase работает под сессией учителя, так что RLS и
// права доступа одинаковые — service role здесь не используется.
//
// Функция возвращает «сырые» данные в том виде, в каком их отдавал Supabase;
// сортировку, форматирование ответов и группировку медиа делает компонент.

export interface ReviewMediaRow {
  id: string
  task_id: string | null
  storage_path: string
  width_px: number | null
  height_px: number | null
  alt_text?: string | null
  sort_order: number | null
  signedUrl: string
}

export interface AttemptReviewData {
  attempt: unknown | null
  answers: unknown[] | null
  answerKeys: { task_id: string | null; correct_answer: unknown; grading_method: string }[] | null
  // Ответы предыдущей сданной попытки — для подсветки изменённых заданий.
  prevAnswers: { task_id: string | null; answer_json: unknown }[] | null
  taskMedia: ReviewMediaRow[] | null
  solutionMedia: ReviewMediaRow[] | null
}

export async function loadAttemptReview(
  supabase: SupabaseClient<Database>,
  attemptId: string,
): Promise<AttemptReviewData> {
  const result: AttemptReviewData = {
    attempt: null, answers: null, answerKeys: null, prevAnswers: null, taskMedia: null, solutionMedia: null,
  }

  const [attemptRes, answersRes] = await Promise.all([
    supabase.from('attempts').select(`
      id, status, score, max_score, started_at, submitted_at, checked_at,
      teacher_reviewed_at, current_task_number, teacher_comment,
      assignment_id, student_id,
      profiles ( full_name, grade ),
      assignments ( test_versions!test_version_id (
        version_number, tests!test_id ( title )
      ))
    `).eq('id', attemptId).single(),
    supabase.from('attempt_task_answers').select(`
      id, task_id, answer_json, awarded_score, is_correct, is_locked, teacher_comment,
      test_tasks ( task_number, task_type, prompt_text, prompt_html, max_score )
    `).eq('attempt_id', attemptId),
  ])

  if (!attemptRes.error && attemptRes.data) result.attempt = attemptRes.data
  if (answersRes.error || !answersRes.data) return result
  result.answers = answersRes.data

  const taskIds = answersRes.data.map((a) => a.task_id).filter(Boolean) as string[]
  if (taskIds.length === 0) return result

  const a = result.attempt as { assignment_id: string | null; student_id: string | null } | null

  const [ansKeysRes, prevAttemptsRes, rawMediaRes, rawSolutionMediaRes] = await Promise.all([
    supabase.from('task_answer_keys').select('task_id, correct_answer, grading_method').in('task_id', taskIds),
    // assignment_id/student_id уже пришли с первым запросом — повторно в
    // attempts за ними не ходим.
    a?.assignment_id && a?.student_id
      ? supabase.from('attempts').select('id, started_at')
          .eq('assignment_id', a.assignment_id).eq('student_id', a.student_id)
          .in('status', ['submitted', 'checked']).order('started_at', { ascending: false }).limit(5)
      : Promise.resolve({ data: null }),
    supabase.from('task_media')
      .select('id, task_id, storage_path, width_px, height_px, alt_text, sort_order')
      .in('task_id', taskIds).order('sort_order', { ascending: true }),
    supabase.from('attempt_answer_media')
      .select('id, task_id, storage_path, width_px, height_px, sort_order')
      .eq('attempt_id', attemptId).order('sort_order', { ascending: true }),
  ])

  if (ansKeysRes.data) result.answerKeys = ansKeysRes.data

  const prevAttemptId = prevAttemptsRes.data?.find((p: { id: string }) => p.id !== attemptId)?.id

  const [prevAnswersRes, signedMediaRes, signedSolutionRes] = await Promise.all([
    prevAttemptId
      ? supabase.from('attempt_task_answers').select('task_id, answer_json').eq('attempt_id', prevAttemptId)
      : Promise.resolve({ data: null }),
    rawMediaRes.data && rawMediaRes.data.length > 0
      ? supabase.storage.from('task-media').createSignedUrls(rawMediaRes.data.map((m) => m.storage_path), 3600)
      : Promise.resolve({ data: null }),
    rawSolutionMediaRes.data && rawSolutionMediaRes.data.length > 0
      ? supabase.storage.from('student-solution-media').createSignedUrls(rawSolutionMediaRes.data.map((m) => m.storage_path), 3600)
      : Promise.resolve({ data: null }),
  ])

  if (prevAnswersRes.data) result.prevAnswers = prevAnswersRes.data

  if (rawMediaRes.data && rawMediaRes.data.length > 0) {
    const urlMap = Object.fromEntries((signedMediaRes.data ?? []).map((s) => [s.path, s.signedUrl]))
    result.taskMedia = rawMediaRes.data.map((m) => ({ ...m, signedUrl: urlMap[m.storage_path] ?? '' }))
  }

  if (rawSolutionMediaRes.data && rawSolutionMediaRes.data.length > 0) {
    const urlMap = Object.fromEntries((signedSolutionRes.data ?? []).map((s) => [s.path, s.signedUrl]))
    result.solutionMedia = rawSolutionMediaRes.data.map((m) => ({ ...m, alt_text: null, signedUrl: urlMap[m.storage_path] ?? '' }))
  }

  return result
}
