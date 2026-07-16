import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateAndSaveAnswer } from '@/lib/ai/generate-answer'
import { NextRequest, after } from 'next/server'

// Фоновая ИИ-генерация ответа (after) может занять до 30 c
export const maxDuration = 60

// POST /api/library/problems/[id]/add-to-test
// Body: { test_version_id: string, task_number?: number, max_score?: number }
// Если у задачи нет ответа — после ответа клиенту ИИ решает её в фоне и
// создаёт ключ для только что созданного test_task (answer_source='ai').
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: libraryProblemId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json() as {
    test_version_id: string
    task_number?:    number
    max_score?:      number
  }

  if (!body.test_version_id) {
    return Response.json({ error: 'test_version_id required' }, { status: 400 })
  }

  // Проверяем что test_version принадлежит орг
  const { data: tv } = await supabase
    .from('test_versions')
    .select('id, test_id, tests!test_id(organization_id)')
    .eq('id', body.test_version_id)
    .single()

  const tvOrgId = (tv?.tests as any)?.organization_id
  if (!tv || tvOrgId !== profile.organization_id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Загружаем задачу из библиотеки
  const admin = createAdminClient()
  const { data: problem } = await admin
    .from('library_problems')
    .select('*, library_problem_media(storage_path, placement, sort_order, alt_text)')
    .eq('id', libraryProblemId)
    .eq('is_active', true)
    .single()

  if (!problem) return Response.json({ error: 'Library problem not found' }, { status: 404 })
  // Задача из чужой (не глобальной) org-библиотеки — доступ запрещён, иначе
  // можно было бы скопировать чужой приватный ответ/решение в свой тест.
  if (problem.organization_id !== null && problem.organization_id !== profile.organization_id) {
    return Response.json({ error: 'Library problem not found' }, { status: 404 })
  }

  // Определяем номер задачи
  let taskNumber = body.task_number
  if (!taskNumber) {
    const { count } = await supabase
      .from('test_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('test_version_id', body.test_version_id)
    taskNumber = (count ?? 0) + 1
  }

  const maxScore = body.max_score ?? problem.default_max_score ?? 1

  // Создаём test_task (копия из библиотеки)
  const { data: task, error: taskErr } = await admin
    .from('test_tasks')
    .insert({
      test_version_id:    body.test_version_id,
      task_number:        taskNumber,
      sort_order:         taskNumber,
      prompt_text:        problem.prompt_text,
      prompt_html:        problem.prompt_html,
      task_type:          problem.task_type,
      grading_method:     problem.grading_method,
      options:            problem.options ?? [],
      max_score:          maxScore,
      has_images:         (problem.library_problem_media as any[])?.some(m => m.placement !== 'solution') ?? false,
      review_status:      'approved',
      library_problem_id: libraryProblemId,
    })
    .select('id')
    .single()

  if (taskErr || !task) {
    return Response.json({ error: taskErr?.message ?? 'Failed to create task' }, { status: 500 })
  }

  const taskId = task.id

  // Ответ
  if (problem.correct_answer !== null && problem.correct_answer !== undefined) {
    await admin.from('task_answer_keys').insert({
      task_id:        taskId,
      correct_answer: problem.correct_answer,
      grading_method: problem.grading_method,
      grading_config: problem.grading_config,
    })
  }

  // Решение
  if (problem.solution_html || problem.solution_text) {
    await admin.from('task_solutions').insert({
      task_id:       taskId,
      solution_text: problem.solution_text,
      solution_html: problem.solution_html,
      has_images:    (problem.library_problem_media as any[])?.some(m => m.placement === 'solution') ?? false,
      access_policy: 'by_request',
    })
  }

  // Медиа — переносим ссылки на storage_path (файлы уже в library-media bucket)
  const media = (problem.library_problem_media as any[]) ?? []
  const taskMedia = media.filter(m => m.placement !== 'solution')
  if (taskMedia.length > 0) {
    await admin.from('task_media').insert(
      taskMedia.map((m, i) => ({
        task_id:      taskId,
        storage_path: m.storage_path,
        media_type:   'image',
        placement:    m.placement ?? 'above_text',
        sort_order:   i,
        alt_text:     m.alt_text,
      }))
    )
  }

  // Инкрементируем счётчик использований
  await admin
    .from('library_problems')
    .update({ used_count: (problem.used_count ?? 0) + 1 })
    .eq('id', libraryProblemId)

  // Нет ответа — решаем ИИ в фоне и вешаем ключ на созданный task.
  // Задачи с картинками (кроме картинок решения) текстовому ИИ не даём.
  const hasConditionImages = ((problem.library_problem_media as any[]) ?? [])
    .some(m => m.placement !== 'solution')
  const aiAnswerPending =
    problem.correct_answer == null && !hasConditionImages && !!process.env.DEEPSEEK_API_KEY
  if (aiAnswerPending) {
    after(() => generateAndSaveAnswer({ source: 'library', problemId: libraryProblemId, taskId, admin }))
  }

  return Response.json({ ok: true, task_id: taskId, task_number: taskNumber, ai_answer_pending: aiAnswerPending })
}
