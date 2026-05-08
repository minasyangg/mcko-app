import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

// PATCH /api/attempts/[id]/grade
// Body: { answers: [{ answer_id, awarded_score, is_correct, teacher_comment? }], finalize?: boolean }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: attemptId } = await params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json() as {
    answers?: { answer_id: string; awarded_score: number; is_correct: boolean; teacher_comment?: string }[]
    finalize?: boolean
    teacher_comment?: string
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  // Update individual answer grades
  // If is_correct = true → lock the answer forever (student can't rewrite in future attempts)
  for (const a of body.answers ?? []) {
    await admin.from('attempt_task_answers').update({
      awarded_score: a.awarded_score,
      is_correct: a.is_correct,
      teacher_comment: a.teacher_comment ?? null,
      teacher_checked_at: now,
      ...(a.is_correct ? {
        is_locked: true,
        locked_in_attempt_id: attemptId,
      } : {}),
    }).eq('id', a.answer_id)
  }

  if (body.finalize) {
    // Recalculate this attempt's score
    const { data: allAnswers } = await admin
      .from('attempt_task_answers')
      .select('awarded_score')
      .eq('attempt_id', attemptId)

    const attemptScore = (allAnswers ?? []).reduce((s, a) => s + (a.awarded_score ?? 0), 0)

    await admin.from('attempts').update({
      status: 'checked',
      checked_at: now,
      score: attemptScore,
      ...(body.teacher_comment ? { teacher_comment: body.teacher_comment } : {}),
    }).eq('id', attemptId)

    // Compute cumulative score: MAX(awarded_score) per task across ALL attempts for this assignment
    const { data: attemptInfo } = await admin
      .from('attempts')
      .select('assignment_id, student_id')
      .eq('id', attemptId)
      .single()

    if (attemptInfo) {
      const { data: allAttemptIds } = await admin
        .from('attempts')
        .select('id')
        .eq('assignment_id', attemptInfo.assignment_id)
        .eq('student_id', attemptInfo.student_id)

      const ids = (allAttemptIds ?? []).map(a => a.id)

      if (ids.length > 0) {
        const { data: allTaskAnswers } = await admin
          .from('attempt_task_answers')
          .select('task_id, awarded_score')
          .in('attempt_id', ids)

        // Max score per task
        const taskBest = new Map<string, number>()
        for (const ans of allTaskAnswers ?? []) {
          if (!ans.task_id) continue
          const prev = taskBest.get(ans.task_id) ?? 0
          taskBest.set(ans.task_id, Math.max(prev, ans.awarded_score ?? 0))
        }
        const cumulativeScore = [...taskBest.values()].reduce((s, v) => s + v, 0)

        // Determine if all attempts are used
        const { data: assignment } = await admin
          .from('assignments')
          .select('max_attempts, test_version_id')
          .eq('id', attemptInfo.assignment_id)
          .single()

        const completedCount = (allAttemptIds ?? []).length
        const maxAttempts = assignment?.max_attempts ?? 1
        const allUsed = completedCount >= maxAttempts

        // Get max possible score from task answers of current attempt
        const { data: taskDefs } = await admin
          .from('attempt_task_answers')
          .select('test_tasks ( max_score )')
          .eq('attempt_id', attemptId)
        const maxScore = (taskDefs ?? []).reduce((s, a) => {
          const tt = (a as any).test_tasks
          return s + (tt?.max_score ?? 1)
        }, 0)

        await admin.from('student_final_results').upsert({
          student_id: attemptInfo.student_id,
          test_version_id: assignment?.test_version_id ?? '',
          final_score: cumulativeScore,
          max_score: maxScore || null,
          attempt_count: completedCount,
          last_completed_at: now,
          status: allUsed ? 'completed' : 'in_progress',
          updated_at: now,
        }, { onConflict: 'student_id,test_version_id' })
      }
    }
  }

  return Response.json({ ok: true })
}
