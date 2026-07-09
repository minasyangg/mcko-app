import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: test } = await supabase
    .from('tests')
    .select('id, is_active, organization_id, current_published_version_id, created_by')
    .eq('id', id)
    .eq('organization_id', profile.organization_id ?? '')
    .single()

  if (!test) return Response.json({ error: 'Test not found' }, { status: 404 })

  // Owner-чек: учитель управляет только своими тестами, admin — любыми в организации
  if (profile.role !== 'admin' && test.created_by !== user.id) {
    return Response.json({ error: 'Управлять публикацией может только создатель теста или администратор' }, { status: 403 })
  }

  const admin = createAdminClient()
  const newActive = !test.is_active
  // When unpublishing: revert to in_review so teacher can edit tasks
  // When republishing: restore published status
  const newStatus = newActive ? 'published' : 'in_review'

  const { error } = await admin
    .from('tests')
    .update({ is_active: newActive, status: newStatus })
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Also update the version status so task editing is allowed/blocked correctly
  if (test.current_published_version_id) {
    await admin
      .from('test_versions')
      .update({ status: newStatus })
      .eq('id', test.current_published_version_id)
  }

  return Response.json({ is_active: newActive, status: newStatus })
}
