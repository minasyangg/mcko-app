import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string; mediaId: string }> }
) {
  const { taskId, mediaId } = await params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()

  const { data: media } = await admin
    .from('task_media').select('id, storage_path, task_id').eq('id', mediaId).single()

  if (!media || media.task_id !== taskId) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  await admin.storage.from('task-media').remove([media.storage_path])
  await admin.from('task_media').delete().eq('id', mediaId)

  return Response.json({ ok: true })
}
