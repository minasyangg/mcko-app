import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { Json } from '@/types/database'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: attemptId } = await params

  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { task_id: string; answer_json: Json }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { task_id, answer_json } = body
  if (!task_id) {
    return NextResponse.json({ error: 'task_id is required' }, { status: 400 })
  }

  // Verify attempt belongs to current user and is in_progress
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

  // Check if this answer is locked (teacher confirmed correct in a previous attempt)
  const { data: existing } = await supabase
    .from('attempt_task_answers')
    .select('is_locked, answer_json, awarded_score')
    .eq('attempt_id', attemptId)
    .eq('task_id', task_id)
    .single()

  if (existing?.is_locked) {
    // Locked task — silently accept without overwriting
    return NextResponse.json({ ok: true, locked: true }, { status: 200 })
  }

  const now = new Date().toISOString()

  // Upsert the answer (only non-locked fields; is_locked/awarded_score remain untouched)
  const { error: upsertError } = await supabase
    .from('attempt_task_answers')
    .upsert(
      {
        attempt_id: attemptId,
        task_id,
        answer_json,
        updated_at: now,
      },
      { onConflict: 'attempt_id,task_id' }
    )

  if (upsertError) {
    console.error('Upsert answer error:', upsertError)
    return NextResponse.json({ error: 'Failed to save answer' }, { status: 500 })
  }

  // Update last_activity_at on the attempt
  await supabase.from('attempts').update({ last_activity_at: now }).eq('id', attemptId)

  return NextResponse.json({ ok: true }, { status: 200 })
}
