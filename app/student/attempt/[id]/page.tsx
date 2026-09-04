import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { TestPlayer } from '@/components/test-player/TestPlayer'
import { enrichTaskMediaWithUrls } from '@/lib/media/signed-urls'
import type { Json } from '@/types/database'
import type { TestTask, TaskMediaWithUrl } from '@/types/domain'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AttemptPage({ params }: PageProps) {
  const { id: assignmentId } = await params
  const supabase = await createClient()

  // Auth check
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  // Load assignment with test version + test info
  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select(`
      id,
      student_id,
      group_id,
      test_version_id,
      max_attempts,
      time_limit_override_sec,
      starts_at,
      ends_at,
      closed_at,
      preserve_answers,
      roadmap_topic_id,
      test_versions!test_version_id (
        id,
        time_limit_sec,
        result_visibility,
        tests!test_id (
          id,
          title,
          subject,
          exam_type
        )
      )
    `)
    .eq('id', assignmentId)
    .single()

  if (assignmentError || !assignment) {
    redirect('/student')
  }

  // Доступ: назначено лично либо через группу. Проверка членства, список
  // попыток и итог назначения не зависят друг от друга, поэтому идут одной
  // волной — раньше членство было отдельным круговым запросом ПЕРЕД ними, и
  // при полном классе это давало лишний последовательный круг на каждого
  // ученика (см. нагрузочный тест: открытие теста — самая медленная фаза).
  const needMembershipCheck = assignment.student_id !== user.id && !!assignment.group_id

  const [{ data: membership }, { data: existingAttempts }, { data: finalResult }] = await Promise.all([
    needMembershipCheck
      ? supabase
          .from('group_members')
          .select('user_id')
          .eq('group_id', assignment.group_id!)
          .eq('user_id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('attempts')
      .select('id, status, started_at')
      .eq('assignment_id', assignmentId)
      .eq('student_id', user.id)
      .in('status', ['in_progress', 'not_started', 'submitted', 'checked'])
      .order('created_at', { ascending: false }),
    supabase
      .from('student_final_results')
      .select('closed_reason')
      .eq('assignment_id', assignmentId)
      .eq('student_id', user.id)
      .maybeSingle(),
  ])

  const hasAccess = assignment.student_id === user.id || !!membership
  if (!hasAccess) {
    redirect('/student')
  }

  const tv = assignment.test_versions as any
  const test = tv?.tests as any

  const timeLimitSec: number | null =
    assignment.time_limit_override_sec ?? tv?.time_limit_sec ?? null

  const listHref = assignment.roadmap_topic_id != null ? '/student/roadmap' : '/student'


  // Count completed attempts to check if more are available
  const completedAttempts = (existingAttempts ?? []).filter(
    (a) => a.status === 'submitted' || a.status === 'checked'
  )
  const maxAttempts = (assignment as any).max_attempts ?? 1
  const attemptsLeft = maxAttempts - completedAttempts.length

  // Only redirect to results if no more attempts are available AND student has no active attempt
  const activeAttempt = existingAttempts?.find(
    (a) => a.status === 'in_progress' || a.status === 'not_started'
  )
  if (completedAttempts.length > 0 && attemptsLeft <= 0 && !activeAttempt) {
    redirect(`/student/attempt/${assignmentId}/result`)
  }

  // Назначение завершено досрочно — новых попыток не даём, даже если лимит не
  // исчерпан. Это ЕДИНСТВЕННОЕ место, где реально создаётся попытка, поэтому
  // проверка здесь, а не только в кнопках на списках.
  // Активной попытки после закрытия быть не должно (closeAssignment
  // финализирует in_progress и гасит not_started), но если она осталась из-за
  // гонки — закрытие важнее: дорешивать в закрытом назначении нечего.
  const isClosed = assignment.closed_at != null || finalResult?.closed_reason != null
  if (isClosed) {
    // на страницу результата — только если есть что показать: иначе она
    // отправит обратно сюда и получится цикл редиректов
    redirect(completedAttempts.length > 0 ? `/student/attempt/${assignmentId}/result` : listHref)
  }

  let attempt = existingAttempts?.find(
    (a) => a.status === 'in_progress' || a.status === 'not_started'
  )

  const now = new Date().toISOString()

  if (!attempt) {
    // Create a new attempt
    const { data: newAttempt, error: createError } = await supabase
      .from('attempts')
      .insert({
        assignment_id: assignmentId,
        student_id: user.id,
        status: 'in_progress',
        started_at: now,
        last_activity_at: now,
        current_task_number: 1,
      })
      .select('id, status, started_at')
      .single()

    if (createError || !newAttempt) {
      redirect('/student')
    }

    attempt = newAttempt

    // Copy previous attempt answers with scores and lock status (always for multi-attempt tests)
    const asgn = assignment as any
    const maxAttempts = asgn?.max_attempts ?? 1
    if (asgn?.preserve_answers || maxAttempts > 1) {
      // Find most recent completed attempt
      const prevAttempt = [...(existingAttempts ?? [])]
        .sort((a, b) => new Date(b.started_at ?? 0).getTime() - new Date(a.started_at ?? 0).getTime())
        .find((a) => a.status === 'submitted' || a.status === 'checked')

      if (prevAttempt) {
        const { data: prevAnswers } = await supabase
          .from('attempt_task_answers')
          .select('task_id, answer_json, awarded_score, is_correct, is_locked, locked_in_attempt_id')
          .eq('attempt_id', prevAttempt.id)

        if (prevAnswers && prevAnswers.length > 0) {
          // service-role клиент: перенос awarded_score/is_correct/is_locked
          // заблокирован для обычных сессий триггером
          // prevent_student_self_grading (029) — легитимный перенос идёт в обход него
          const admin = createAdminClient()
          await admin.from('attempt_task_answers').insert(
            prevAnswers.map((a) => ({
              attempt_id: newAttempt.id,
              task_id: a.task_id,
              answer_json: a.answer_json,
              awarded_score: a.awarded_score,       // carry forward score
              is_correct: a.is_correct,              // carry forward correctness
              is_locked: a.is_locked,                // carry forward lock
              locked_in_attempt_id: a.locked_in_attempt_id,
            }))
          )
        }
      }
    }
  } else if (attempt.status === 'not_started') {
    // Transition to in_progress
    await supabase
      .from('attempts')
      .update({ status: 'in_progress', started_at: now, last_activity_at: now })
      .eq('id', attempt.id)
    attempt = { ...attempt, status: 'in_progress', started_at: now }
  }

  // Load tasks
  const { data: tasks, error: tasksError } = await supabase
    .from('test_tasks')
    .select('*')
    .eq('test_version_id', assignment.test_version_id)
    .order('sort_order', { ascending: true })

  if (tasksError || !tasks) {
    redirect('/student')
  }

  const taskIds = tasks.map((t) => t.id)

  // Load saved answers (with lock status) and task media in parallel
  const [{ data: savedAnswers }, { data: rawMedia }] = await Promise.all([
    supabase
      .from('attempt_task_answers')
      .select('task_id, answer_json, is_locked, awarded_score')
      .eq('attempt_id', attempt.id),
    supabase
      .from('task_media')
      .select('*')
      .in('task_id', taskIds)
      .order('sort_order', { ascending: true }),
  ])

  // Обратная связь с прошлой попытки: балл и комментарий учителя по каждому
  // НЕзаблокированному заданию. На странице результата это видно, а в режиме
  // решения не было — ученик видел разблокированное задание и не понимал, что
  // именно в нём не так. Берём с прошлой завершённой попытки, а не с текущей:
  // перенос ответов (carry forward выше) копирует балл, но не teacher_comment.
  const prevCompleted = [...(existingAttempts ?? [])]
    .sort((a, b) => new Date(b.started_at ?? 0).getTime() - new Date(a.started_at ?? 0).getTime())
    .find((a) => a.status === 'submitted' || a.status === 'checked')

  const priorFeedback: Record<string, { awardedScore: number; teacherComment: string | null }> = {}
  if (prevCompleted && prevCompleted.id !== attempt.id) {
    const { data: prevGraded } = await supabase
      .from('attempt_task_answers')
      .select('task_id, awarded_score, teacher_comment, is_locked')
      .eq('attempt_id', prevCompleted.id)
    for (const a of prevGraded ?? []) {
      if (!a.task_id || a.awarded_score == null) continue
      // заблокированные (полный балл) тоже включаем: комментарий учителя к ним
      // бывает полезным советом на будущее и иначе в режиме решения не виден
      priorFeedback[a.task_id] = {
        awardedScore: a.awarded_score,
        teacherComment: a.teacher_comment,
      }
    }
  }

  const initialAnswers: Record<string, Json> = {}
  const lockedTaskIds: string[] = []

  for (const ans of savedAnswers ?? []) {
    if (ans.answer_json !== null && ans.answer_json !== undefined) {
      initialAnswers[ans.task_id!] = ans.answer_json
    }
    if (ans.is_locked && ans.task_id) {
      lockedTaskIds.push(ans.task_id)
    }
  }

  // Generate signed URLs for all task media
  const mediaWithUrls = await enrichTaskMediaWithUrls(supabase, rawMedia ?? [])

  const taskMediaMap: Record<string, TaskMediaWithUrl[]> = {}
  for (const m of mediaWithUrls) {
    if (!m.task_id) continue
    if (!taskMediaMap[m.task_id]) taskMediaMap[m.task_id] = []
    taskMediaMap[m.task_id].push(m)
  }

  return (
    <TestPlayer
      assignmentId={assignmentId}
      attemptId={attempt.id}
      startedAt={attempt.started_at ?? null}
      tasks={tasks as TestTask[]}
      initialAnswers={initialAnswers}
      lockedTaskIds={lockedTaskIds}
      priorFeedback={priorFeedback}
      taskMediaMap={taskMediaMap}
      timeLimitSec={timeLimitSec}
      testTitle={test?.title ?? 'Тест'}
      subject={test?.subject ?? null}
      examType={test?.exam_type ?? null}
      backHref={listHref}
      backLabel={assignment.roadmap_topic_id != null ? 'Вернуться в программы' : 'Вернуться к списку тестов'}
    />
  )
}
