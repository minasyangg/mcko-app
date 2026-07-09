import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { finalizeAttempt } from '@/lib/grading/finalize'

// Ученик сдаёт свою попытку. Проверка владения + статуса, затем общая
// финализация (авто-проверка + пересчёт итога) в lib/grading/finalize.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: attemptId } = await params

  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: attempt, error: attemptError } = await supabase
    .from('attempts')
    .select('id, student_id, status')
    .eq('id', attemptId)
    .single()

  if (attemptError || !attempt) {
    return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })
  }
  if (attempt.student_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (attempt.status !== 'in_progress') {
    return NextResponse.json({ error: 'Attempt is not in progress' }, { status: 409 })
  }

  const result = await finalizeAttempt(attemptId)
  if (!result) {
    return NextResponse.json({ error: 'Failed to finalize attempt' }, { status: 500 })
  }

  return NextResponse.json({
    attempt_id: attemptId,
    score: result.score,
    max_score: result.max_score,
    status: result.status,
  })
}
