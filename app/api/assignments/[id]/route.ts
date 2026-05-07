import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()

  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Verify the assignment belongs to the teacher's org
  const { data: assignment } = await admin
    .from('assignments')
    .select('id, organization_id')
    .eq('id', id)
    .single()

  if (!assignment || assignment.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Get attempt IDs first, then delete related records
  const { data: attempts } = await admin
    .from('attempts')
    .select('id')
    .eq('assignment_id', id)

  const attemptIds = (attempts ?? []).map(a => a.id)

  if (attemptIds.length > 0) {
    await admin.from('attempt_task_answers').delete().in('attempt_id', attemptIds)
    await admin.from('presence_events').delete().in('attempt_id', attemptIds)
    await admin.from('solution_requests').delete().in('attempt_id', attemptIds)
    await admin.from('attempts').delete().in('id', attemptIds)
  }

  await admin.from('assignments').delete().eq('id', id)

  return NextResponse.json({ ok: true })
}
