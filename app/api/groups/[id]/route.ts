import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type Params = { params: Promise<{ id: string }> }

// DELETE /api/groups/[id]
// Removes group_members, group assignments (+ their attempts/answers), then the group.
// Students themselves are NOT deleted.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id: groupId } = await params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Verify the group belongs to this teacher's organization
  const { data: group } = await supabase
    .from('groups').select('organization_id').eq('id', groupId).single()
  if (!group || group.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const admin = createAdminClient()

  // 1. Get all assignments for this group
  const { data: assignments } = await admin
    .from('assignments').select('id').eq('group_id', groupId)
  const assignmentIds = (assignments ?? []).map(a => a.id)

  if (assignmentIds.length > 0) {
    // 2. Get all attempts for those assignments
    const { data: attempts } = await admin
      .from('attempts').select('id').in('assignment_id', assignmentIds)
    const attemptIds = (attempts ?? []).map(a => a.id)

    if (attemptIds.length > 0) {
      // 3. Delete attempt_task_answers, presence_events, solution_requests
      await admin.from('attempt_task_answers').delete().in('attempt_id', attemptIds)
      await admin.from('presence_events').delete().in('attempt_id', attemptIds)
      await admin.from('solution_requests').delete().in('attempt_id', attemptIds)
      // 4. Delete attempts
      await admin.from('attempts').delete().in('id', attemptIds)
    }

    // 5. Delete assignments
    await admin.from('assignments').delete().in('id', assignmentIds)
  }

  // 6. Remove all group memberships (students stay in the system)
  await admin.from('group_members').delete().eq('group_id', groupId)

  // 7. Delete the group itself
  const { error } = await admin.from('groups').delete().eq('id', groupId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
