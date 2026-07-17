import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateAndSaveAnswer } from '@/lib/ai/generate-answer'
import { buildCompositeAnswerKey } from '@/lib/grading/multi-part-answer'
import { NextRequest, after } from 'next/server'

// Фоновая ИИ-генерация ответа (after) может занять до 30 c
export const maxDuration = 60

// POST /api/books/problems/[id]/add-to-test
// Body: { test_version_id: string, task_number?: number, max_score?: number }
// Копирует задание из книги в тест (зеркало library add-to-test).
// Если у задания нет ответа — после ответа клиенту ИИ решает его в фоне и
// создаёт ключ для только что созданного test_task (answer_source='ai').
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: bookProblemId } = await params
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

  // Версия теста должна принадлежать организации учителя
  const { data: tv } = await supabase
    .from('test_versions')
    .select('id, status, test_id, tests!test_id(organization_id)')
    .eq('id', body.test_version_id)
    .single()

  const tvOrgId = (tv?.tests as unknown as { organization_id: string } | null)?.organization_id
  if (!tv || tvOrgId !== profile.organization_id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (tv.status === 'published') {
    return Response.json({ error: 'Нельзя добавлять задания в опубликованную версию' }, { status: 422 })
  }

  // Задание книги (RLS: своя организация или глобальная книга)
  const { data: problem } = await supabase
    .from('book_problems')
    .select('*')
    .eq('id', bookProblemId)
    .eq('is_active', true)
    .single()

  if (!problem) return Response.json({ error: 'Book problem not found' }, { status: 404 })

  const admin = createAdminClient()

  // Номер задачи в тесте
  let taskNumber = body.task_number
  if (!taskNumber) {
    const { count } = await supabase
      .from('test_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('test_version_id', body.test_version_id)
    taskNumber = (count ?? 0) + 1
  }

  // Плоский текст из markdown (для prompt_text)
  const promptText = problem.prompt_md
    .replace(/<[^>]+>/g, ' ')
    .replace(/\$\$[\s\S]+?\$\$/g, '[формула]')
    .replace(/\$[^$\n]+\$/g, '[формула]')
    .replace(/\s+/g, ' ')
    .trim() || problem.prompt_md.slice(0, 200)

  // Автосборка составного ответа по меткам (а)/б)/… при копировании эталона
  // из книги в тест — только если у задания не выбран явно 'manual'.
  // У книг correct_answer хранится как {text: "..."} (не голой строкой, как
  // у библиотеки) — распаковываем перед разбором на части.
  const bookAnswerText =
    problem.correct_answer !== null && typeof problem.correct_answer === 'object' && !Array.isArray(problem.correct_answer)
      ? String((problem.correct_answer as Record<string, unknown>).text ?? '') || null
      : typeof problem.correct_answer === 'string' ? problem.correct_answer : null

  const composite = problem.grading_method !== 'manual' && bookAnswerText
    ? buildCompositeAnswerKey(bookAnswerText)
    : { isComposite: false as const, correctAnswerJson: problem.correct_answer }

  const { data: task, error: taskErr } = await admin
    .from('test_tasks')
    .insert({
      test_version_id: body.test_version_id,
      task_number:     taskNumber,
      sort_order:      taskNumber,
      prompt_text:     promptText,
      prompt_html:     problem.prompt_md,
      task_type:       composite.isComposite ? 'composite' : problem.task_type,
      grading_method:  problem.grading_method,
      options:         problem.options ?? [],
      max_score:       body.max_score ?? 1,
      has_images:      problem.has_images,
      review_status:   'approved',
      book_problem_id: bookProblemId,
      ...(composite.isComposite && composite.answerParts ? { answer_parts: composite.answerParts } : {}),
    })
    .select('id')
    .single()

  if (taskErr || !task) {
    return Response.json({ error: taskErr?.message ?? 'Failed to create task' }, { status: 500 })
  }

  // Ответ из книги
  if (problem.correct_answer !== null && problem.correct_answer !== undefined) {
    await admin.from('task_answer_keys').insert({
      task_id:        task.id,
      correct_answer: composite.correctAnswerJson,
      grading_method: problem.grading_method,
    })
  }

  await admin
    .from('book_problems')
    .update({ used_count: (problem.used_count ?? 0) + 1 })
    .eq('id', bookProblemId)

  // Нет ответа — решаем ИИ в фоне и вешаем ключ на созданный task
  const aiAnswerPending =
    problem.correct_answer == null && !problem.has_images && !!process.env.DEEPSEEK_API_KEY
  if (aiAnswerPending) {
    after(() => generateAndSaveAnswer({ source: 'book', problemId: bookProblemId, taskId: task.id, admin }))
  }

  return Response.json({ ok: true, task_id: task.id, task_number: taskNumber, ai_answer_pending: aiAnswerPending })
}
