import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET — get all solution requests for this attempt (student sees their own requests + approved solutions)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: attemptId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('solution_requests')
    .select(`
      id, task_id, status, created_at, teacher_note,
      task_solutions ( solution_text )
    `)
    .eq('attempt_id', attemptId)
    .eq('student_id', user.id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data ?? [])
}

// POST — student creates a solution request for a specific task
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: attemptId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { task_id, student_message } = await req.json()
  if (!task_id) return Response.json({ error: 'task_id required' }, { status: 400 })

  // Verify the attempt belongs to this student
  const { data: attempt } = await supabase
    .from('attempts')
    .select('id, student_id')
    .eq('id', attemptId)
    .eq('student_id', user.id)
    .single()

  if (!attempt) return Response.json({ error: 'Attempt not found' }, { status: 404 })

  // Check if request already exists
  const { data: existing } = await supabase
    .from('solution_requests')
    .select('id, status')
    .eq('attempt_id', attemptId)
    .eq('task_id', task_id)
    .eq('student_id', user.id)
    .single()

  if (existing) return Response.json(existing)

  const { data, error } = await supabase
    .from('solution_requests')
    .insert({
      attempt_id: attemptId,
      task_id,
      student_id: user.id,
      student_message: student_message ?? null,
      status: 'pending',
    })
    .select('id, status')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}
