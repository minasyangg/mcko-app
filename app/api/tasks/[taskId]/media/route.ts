import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp')

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })
  if (!file.type.startsWith('image/')) {
    return Response.json({ error: 'File must be an image' }, { status: 400 })
  }
  // 10 MB limit
  if (file.size > 10 * 1024 * 1024) {
    return Response.json({ error: 'File too large (max 10 MB)' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: task } = await admin
    .from('test_tasks').select('id, test_version_id').eq('id', taskId).single()
  if (!task) return Response.json({ error: 'Task not found' }, { status: 404 })

  const rawBuffer = Buffer.from(await file.arrayBuffer())

  let webpBuffer: Buffer
  let width: number | null = null
  let height: number | null = null
  try {
    const meta = await sharp(rawBuffer).metadata()
    width = meta.width ?? null
    height = meta.height ?? null
    webpBuffer = await sharp(rawBuffer)
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer()
  } catch {
    webpBuffer = rawBuffer
  }

  const storagePath = `task-media/manual/${task.test_version_id}/${taskId}/${Date.now()}.webp`

  const { error: uploadError } = await admin.storage
    .from('task-media')
    .upload(storagePath, webpBuffer, { contentType: 'image/webp', upsert: false })

  if (uploadError) {
    return Response.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: signed } = await admin.storage
    .from('task-media').createSignedUrl(storagePath, 3600)

  const { data: mediaRecord, error: mediaError } = await admin
    .from('task_media').insert({
      task_id: taskId,
      storage_path: storagePath,
      media_type: 'image',
      format: 'webp',
      width_px: width,
      height_px: height,
      file_size_bytes: webpBuffer.length,
      is_manually_uploaded: true,
      placement: 'above_text',
      sort_order: 0,
    }).select('id').single()

  if (mediaError || !mediaRecord) {
    await admin.storage.from('task-media').remove([storagePath])
    return Response.json({ error: 'Failed to create media record' }, { status: 500 })
  }

  return Response.json({
    id: mediaRecord.id,
    signedUrl: signed?.signedUrl ?? '',
    width_px: width,
    height_px: height,
  })
}
