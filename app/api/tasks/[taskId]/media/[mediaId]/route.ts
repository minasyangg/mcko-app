import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string; mediaId: string }> }
) {
  const { taskId, mediaId } = await params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()

  const { data: media } = await admin
    .from('task_media')
    .select('id, storage_path, task_id, test_tasks!task_id(test_versions!test_version_id(tests!test_id(organization_id)))')
    .eq('id', mediaId)
    .eq('task_id', taskId)
    .single()

  if (!media) return Response.json({ error: 'Not found' }, { status: 404 })

  const taskOrgId = ((media as any).test_tasks as any)?.test_versions?.tests?.organization_id
  if (taskOrgId && taskOrgId !== profile.organization_id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  await admin.storage.from('task-media').remove([media.storage_path])
  await admin.from('task_media').delete().eq('id', mediaId)

  return Response.json({ ok: true })
}
