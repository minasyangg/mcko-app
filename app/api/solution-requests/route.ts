import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'

const schema = z.object({
  attempt_id: zUuid(),
  task_id: zUuid(),
  student_message: z.string().max(500).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { attempt_id, task_id, student_message } = parsed.data

  // Verify attempt belongs to this student
  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, student_id, status')
    .eq('id', attempt_id)
    .single()

  if (!attempt || attempt.student_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!['submitted', 'checked'].includes(attempt.status)) {
    return NextResponse.json({ error: 'Attempt not submitted' }, { status: 409 })
  }

  // Check task has a solution
  const { data: solution } = await supabase
    .from('task_solutions')
    .select('id')
    .eq('task_id', task_id)
    .single()

  if (!solution) {
    return NextResponse.json({ error: 'No solution available for this task' }, { status: 404 })
  }

  // Upsert — if request already exists update the message, don't duplicate
  const { data: existing } = await supabase
    .from('solution_requests')
    .select('id, status')
    .eq('attempt_id', attempt_id)
    .eq('task_id', task_id)
    .single()

  if (existing) {
    if (existing.status === 'approved') {
      return NextResponse.json({ already_approved: true, id: existing.id })
    }
    return NextResponse.json({ already_exists: true, id: existing.id })
  }

  const { data: req, error } = await supabase
    .from('solution_requests')
    .insert({
      attempt_id,
      task_id,
      student_id: user.id,
      student_message: student_message ?? null,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ id: req.id }, { status: 201 })
}
