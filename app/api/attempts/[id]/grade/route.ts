import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'
import { after } from 'next/server'
import { notifyAttemptFinalized } from '@/lib/notifications/send'
import { updateCumulativeResult } from '@/lib/grading/finalize'

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
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Verify the attempt belongs to the teacher's organization
  const { data: attemptCheck } = await supabase
    .from('attempts')
    .select('id, assignments!inner(organization_id)')
    .eq('id', attemptId)
    .single()
  const attemptOrgId = (attemptCheck?.assignments as { organization_id: string } | null)?.organization_id
  if (!attemptCheck || attemptOrgId !== profile.organization_id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json() as {
    answers?: { answer_id: string; awarded_score: number; is_correct: boolean; teacher_comment?: string }[]
    finalize?: boolean
    teacher_comment?: string
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()
  let finalizedScore: number | undefined

  // Find locked answers so we don't overwrite scores that were finalized in a previous attempt
  const answerIds = (body.answers ?? []).map(a => a.answer_id)
  const lockedSet = new Set<string>()
  if (answerIds.length > 0) {
    const { data: locked } = await admin
      .from('attempt_task_answers')
      .select('id')
      .in('id', answerIds)
      .eq('is_locked', true)
    for (const l of locked ?? []) lockedSet.add(l.id)
  }

  // Update individual answer grades
  // If is_correct = true → lock the answer forever (student can't rewrite in future attempts)
  await Promise.all(
    (body.answers ?? [])
      .filter(a => !lockedSet.has(a.answer_id))  // already locked in a previous attempt
      .map(a => admin.from('attempt_task_answers').update({
        awarded_score: a.awarded_score,
        is_correct: a.is_correct,
        teacher_comment: a.teacher_comment ?? null,
        teacher_checked_at: now,
        ...(a.is_correct ? {
          is_locked: true,
          locked_in_attempt_id: attemptId,
        } : {}),
      }).eq('id', a.answer_id))
  )

  if (body.finalize) {
    // Recalculate this attempt's score
    const { data: allAnswers } = await admin
      .from('attempt_task_answers')
      .select('awarded_score')
      .eq('attempt_id', attemptId)

    const attemptScore = (allAnswers ?? []).reduce((s, a) => s + (a.awarded_score ?? 0), 0)
    finalizedScore = attemptScore

    await admin.from('attempts').update({
      status: 'checked',
      checked_at: now,
      score: attemptScore,
      ...(body.teacher_comment ? { teacher_comment: body.teacher_comment } : {}),
    }).eq('id', attemptId)

    // Накопительный итог: MAX(awarded_score) по каждому заданию среди всех
    // завершённых попыток — общая логика с авто-финализацией (submit), см.
    // lib/grading/finalize.ts.
    const { data: attemptInfo } = await admin
      .from('attempts')
      .select('assignment_id, student_id')
      .eq('id', attemptId)
      .single()

    if (attemptInfo) {
      await updateCumulativeResult(admin, attemptInfo.assignment_id, attemptInfo.student_id)
    }
  }

  // учитель завершил проверку → ученику уходит результат
  if (body.finalize) {
    after(() => notifyAttemptFinalized(attemptId))
  }

  return Response.json({ ok: true, ...(finalizedScore !== undefined ? { score: finalizedScore } : {}) })
}
