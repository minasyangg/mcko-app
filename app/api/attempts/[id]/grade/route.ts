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
  for (const a of body.answers ?? []) {
    await admin.from('attempt_task_answers').update({
      awarded_score: a.awarded_score,
      is_correct: a.is_correct,
      teacher_comment: a.teacher_comment ?? null,
    }).eq('id', a.answer_id)
  }

  if (body.finalize) {
    // Recalculate total score from all answers
    const { data: allAnswers } = await admin
      .from('attempt_task_answers')
      .select('awarded_score')
      .eq('attempt_id', attemptId)

    const totalScore = (allAnswers ?? []).reduce((s, a) => s + (a.awarded_score ?? 0), 0)

    await admin.from('attempts').update({
      status: 'checked',
      checked_at: now,
      score: totalScore,
      ...(body.teacher_comment ? { teacher_comment: body.teacher_comment } : {}),
    }).eq('id', attemptId)
  }

  return Response.json({ ok: true })
}
