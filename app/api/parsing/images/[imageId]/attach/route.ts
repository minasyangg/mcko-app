import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> }
) {
  try {
    const { imageId } = await params
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['teacher', 'admin'].includes(profile.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { task_id, placement } = body as { task_id: string; placement?: string }

    if (!task_id) {
      return Response.json({ error: 'task_id is required' }, { status: 400 })
    }

    // Fetch the existing media record to get storage_path
    const { data: media, error: mediaError } = await supabase
      .from('task_media')
      .select('id, storage_path')
      .eq('id', imageId)
      .single()

    if (mediaError || !media) {
      return Response.json({ error: 'Image not found' }, { status: 404 })
    }

    // Update task_id and placement on the media record
    const { error: updateError } = await supabase
      .from('task_media')
      .update({
        task_id,
        placement: placement ?? 'above_text',
      })
      .eq('id', imageId)

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 })
    }

    // Update has_images on the task
    const { error: taskUpdateError } = await supabase
      .from('test_tasks')
      .update({ has_images: true })
      .eq('id', task_id)

    if (taskUpdateError) {
      console.error('[images/attach] task update error:', taskUpdateError)
    }

    return Response.json({ success: true })
  } catch (err) {
    console.error('[images/[imageId]/attach]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
