import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'

// Данные печатной версии попытки (/print/attempts/[id]): все задания версии
// теста — с условием, вариантами и картинками задания, — ответ ученика и
// эталон. В отличие от окна проверки (review-data.ts) задания берутся из
// версии теста, а не из ответов: пропущенное учеником задание тоже должно
// попасть на бумагу. Фото решений ученика сюда не грузятся — печатная
// версия про условие и ответы. Доступ решает RLS (сессия пользователя).

export interface PrintTask {
  id: string
  number: number
  taskType: string
  promptText: string
  promptHtml: string | null
  options: { id: string; text: string }[]
  maxScore: number | null
  /** Картинки задания вне текста условия — как у ученика (TaskImageGallery):
   *  above_text до условия, below_text после; inline уже внутри prompt_html */
  images: { id: string; url: string; alt: string | null; placement: 'above_text' | 'below_text' }[]
  answer: {
    answerJson: Json
    awardedScore: number | null
    isCorrect: boolean | null
    isLocked: boolean
    teacherComment: string | null
  } | null
  correctAnswer: Json | null
}

export interface AttemptPrintData {
  studentName: string
  grade: string | null
  testTitle: string
  status: string
  teacherReviewed: boolean
  score: number | null
  maxScore: number | null
  submittedAt: string | null
  checkedAt: string | null
  teacherComment: string | null
  tasks: PrintTask[]
}

type TaskRow = {
  id: string
  task_number: number
  task_type: string
  prompt_text: string
  prompt_html: string | null
  options: Json | null
  max_score: number | null
}

const TASK_COLUMNS = 'id, task_number, task_type, prompt_text, prompt_html, options, max_score'

function toOptions(raw: Json | null): { id: string; text: string }[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return []
    const o = item as Record<string, Json | undefined>
    const id = String(o['id'] ?? '')
    return id ? [{ id, text: String(o['text'] ?? '') }] : []
  })
}

export async function loadAttemptPrint(
  supabase: SupabaseClient<Database>,
  attemptId: string,
): Promise<AttemptPrintData | null> {
  const [attemptRes, answersRes] = await Promise.all([
    supabase.from('attempts').select(`
      id, status, score, max_score, submitted_at, checked_at, teacher_reviewed_at, teacher_comment,
      profiles ( full_name, grade ),
      assignments ( test_version_id, test_versions!test_version_id ( tests!test_id ( title ) ) )
    `).eq('id', attemptId).maybeSingle(),
    supabase.from('attempt_task_answers').select(`
      task_id, answer_json, awarded_score, is_correct, is_locked, teacher_comment,
      test_tasks ( ${TASK_COLUMNS} )
    `).eq('attempt_id', attemptId).limit(300),
  ])
  const attempt = attemptRes.data as unknown as {
    status: string; score: number | null; max_score: number | null
    submitted_at: string | null; checked_at: string | null; teacher_reviewed_at: string | null
    teacher_comment: string | null
    profiles: { full_name: string; grade: string | null } | null
    assignments: { test_version_id: string | null; test_versions: { tests: { title: string } | null } | null } | null
  } | null
  if (!attempt) return null

  const answers = (answersRes.data ?? []) as unknown as {
    task_id: string | null; answer_json: Json; awarded_score: number | null; is_correct: boolean | null
    is_locked: boolean; teacher_comment: string | null; test_tasks: TaskRow | null
  }[]

  // Задания версии + задания из ответов (на случай, если какое-то из них
  // RLS отдаёт только через ответ)
  const versionId = attempt.assignments?.test_version_id
  const versionTasks = versionId
    ? ((await supabase.from('test_tasks').select(TASK_COLUMNS).eq('test_version_id', versionId)
        .order('task_number', { ascending: true }).limit(300)).data ?? []) as TaskRow[]
    : []
  const taskById = new Map<string, TaskRow>(versionTasks.map((t) => [t.id, t]))
  for (const a of answers) if (a.test_tasks && !taskById.has(a.test_tasks.id)) taskById.set(a.test_tasks.id, a.test_tasks)
  const tasks = [...taskById.values()].sort((a, b) => a.task_number - b.task_number)
  const taskIds = tasks.map((t) => t.id)

  const [keysRes, mediaRes] = taskIds.length
    ? await Promise.all([
        supabase.from('task_answer_keys').select('task_id, correct_answer').in('task_id', taskIds).limit(300),
        supabase.from('task_media').select('id, task_id, storage_path, alt_text, sort_order, placement')
          .in('task_id', taskIds).order('sort_order', { ascending: true }).limit(1000),
      ])
    : [{ data: [] }, { data: [] }]

  const media = ((mediaRes.data ?? []) as { id: string; task_id: string | null; storage_path: string; alt_text: string | null; placement: string | null }[])
    // inline — рисунок уже в тексте условия (в т.ч. бывшие дубли, миграция 103)
    .filter((m) => m.placement !== 'inline')
  const signed = media.length
    ? (await supabase.storage.from('task-media').createSignedUrls(media.map((m) => m.storage_path), 3600)).data ?? []
    : []
  const urlByPath = new Map(signed.map((s) => [s.path, s.signedUrl]))

  const keyByTask = new Map(((keysRes.data ?? []) as { task_id: string | null; correct_answer: Json }[])
    .map((k) => [k.task_id, k.correct_answer]))
  const answerByTask = new Map(answers.map((a) => [a.task_id, a]))

  return {
    studentName: attempt.profiles?.full_name ?? 'Ученик',
    grade: attempt.profiles?.grade ?? null,
    testTitle: attempt.assignments?.test_versions?.tests?.title ?? 'Работа',
    status: attempt.status,
    teacherReviewed: !!attempt.teacher_reviewed_at,
    score: attempt.score,
    maxScore: attempt.max_score,
    submittedAt: attempt.submitted_at,
    checkedAt: attempt.checked_at,
    teacherComment: attempt.teacher_comment,
    tasks: tasks.map((t) => {
      const a = answerByTask.get(t.id)
      return {
        id: t.id,
        number: t.task_number,
        taskType: t.task_type,
        promptText: t.prompt_text,
        promptHtml: t.prompt_html,
        options: toOptions(t.options),
        maxScore: t.max_score,
        images: media
          .filter((m) => m.task_id === t.id && urlByPath.get(m.storage_path))
          .map((m) => ({
            id: m.id, url: urlByPath.get(m.storage_path)!, alt: m.alt_text,
            placement: m.placement === 'below_text' ? 'below_text' as const : 'above_text' as const,
          })),
        answer: a
          ? { answerJson: a.answer_json, awardedScore: a.awarded_score, isCorrect: a.is_correct, isLocked: a.is_locked, teacherComment: a.teacher_comment }
          : null,
        correctAnswer: keyByTask.get(t.id) ?? null,
      }
    }),
  }
}
