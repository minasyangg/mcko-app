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

  // Find locked answers so we don't overwrite scores that were finalized in a
  // previous attempt; заодно тянем max_score задания — блокировка считается на
  // сервере, а не по флагу is_correct от клиента (тот приходит из браузера
  // учителя и уже один раз означал «балл > 0», из-за чего частично верные
  // ответы запирались навсегда).
  const answerIds = (body.answers ?? []).map(a => a.answer_id)
  const lockedSet = new Set<string>()
  const maxScoreById = new Map<string, number>()
  if (answerIds.length > 0) {
    const { data: rows } = await admin
      .from('attempt_task_answers')
      .select('id, is_locked, test_tasks!task_id ( max_score )')
      .in('id', answerIds)
    for (const r of rows ?? []) {
      if (r.is_locked) lockedSet.add(r.id)
      const maxScore = (r.test_tasks as unknown as { max_score: number | null } | null)?.max_score
      maxScoreById.set(r.id, maxScore ?? 1)
    }
  }

  // Update individual answer grades.
  // Задание запирается ТОЛЬКО при полном балле: частично верный ответ должен
  // остаться доступным, чтобы ученик дотянул его до максимума в следующей
  // попытке. is_correct тоже выводим из балла, а не берём у клиента — иначе
  // смысл флага разъезжается между авто-проверкой (там он всегда «полный
  // балл», см. lib/grading/checker.ts) и ручной.
  await Promise.all(
    (body.answers ?? [])
      .filter(a => !lockedSet.has(a.answer_id))  // already locked in a previous attempt
      .map(a => {
        const full = a.awarded_score >= (maxScoreById.get(a.answer_id) ?? 1)
        return admin.from('attempt_task_answers').update({
          awarded_score: a.awarded_score,
          is_correct: full,
          teacher_comment: a.teacher_comment ?? null,
          teacher_checked_at: now,
          is_locked: full,
          locked_in_attempt_id: full ? attemptId : null,
        }).eq('id', a.answer_id)
      })
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
      // Отдельно от checked_at: тот ставится и при чистой авто-проверке без
      // участия учителя (lib/grading/finalize.ts). teacher_reviewed_at — знак
      // именно ручной проверки, по нему таб «На проверке» в мониторинге сразу
      // отпускает работу, даже если у ученика остались попытки (см. миграцию
      // 057 и случай Власенко Глеба).
      teacher_reviewed_at: now,
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

  // учитель завершил проверку → ученику уходит результат.
  // teacherNotice: false — «работа сдана» самому проверяющему бессмысленно:
  // он только что закрыл эту работу вручную.
  if (body.finalize) {
    after(() => notifyAttemptFinalized(attemptId, { teacherNotice: false }))
  }

  return Response.json({ ok: true, ...(finalizedScore !== undefined ? { score: finalizedScore } : {}) })
}
