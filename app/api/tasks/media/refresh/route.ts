import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { enrichTaskMediaWithUrls } from '@/lib/media/signed-urls'
import type { TaskMedia } from '@/types/domain'

// POST /api/tasks/media/refresh
// Accepts { taskIds: string[] }, returns fresh signed URLs for student's task images.
// Called client-side when images fail to load (expired URLs).
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const taskIds: string[] = Array.isArray(body.taskIds) ? body.taskIds.slice(0, 20) : []
    if (taskIds.length === 0) return Response.json({ media: [] })

    // RLS ensures student can only read media for their assigned tasks
    const { data: rawMedia } = await supabase
      .from('task_media')
      .select('*')
      .in('task_id', taskIds)
      .order('sort_order', { ascending: true })

    if (!rawMedia?.length) return Response.json({ media: [] })

    const enriched = await enrichTaskMediaWithUrls(supabase, rawMedia as TaskMedia[])
    return Response.json({ media: enriched })
  } catch (err) {
    console.error('[POST /api/tasks/media/refresh]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
