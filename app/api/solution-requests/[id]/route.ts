import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// PATCH — teacher approves or rejects a solution request
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()

  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { status, teacher_note } = await req.json()
  if (!['approved', 'rejected'].includes(status)) {
    return Response.json({ error: 'status must be approved or rejected' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('solution_requests')
    .update({
      status,
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      teacher_note: teacher_note ?? null,
    })
    .eq('id', id)
    .select('id, status, task_id')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
