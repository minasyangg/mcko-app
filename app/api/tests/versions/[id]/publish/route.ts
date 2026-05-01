import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: versionId } = await params
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile || !['teacher', 'admin'].includes(profile.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check for any pending or needs_fix tasks
    const { data: blockingTasks, error: tasksError } = await supabase
      .from('test_tasks')
      .select('id, review_status')
      .eq('test_version_id', versionId)
      .in('review_status', ['pending', 'needs_fix'])
      .limit(1)

    if (tasksError) {
      return Response.json({ error: tasksError.message }, { status: 500 })
    }

    if (blockingTasks && blockingTasks.length > 0) {
      return Response.json(
        { error: 'Есть задания, требующие проверки. Одобрите или отклоните все задания перед публикацией.' },
        { status: 422 }
      )
    }

    // Get the test_version to find the test_id
    const { data: version, error: versionError } = await supabase
      .from('test_versions')
      .select('id, test_id')
      .eq('id', versionId)
      .single()

    if (versionError || !version) {
      return Response.json({ error: 'Version not found' }, { status: 404 })
    }

    const now = new Date().toISOString()

    // Publish the version
    const { error: publishVersionError } = await supabase
      .from('test_versions')
      .update({
        status: 'published',
        published_at: now,
        published_by: user.id,
      })
      .eq('id', versionId)

    if (publishVersionError) {
      return Response.json({ error: publishVersionError.message }, { status: 500 })
    }

    // Update the test record
    if (version.test_id) {
      const { error: publishTestError } = await supabase
        .from('tests')
        .update({
          status: 'published',
          current_published_version_id: versionId,
          updated_at: now,
        })
        .eq('id', version.test_id)

      if (publishTestError) {
        console.error('[publish] test update error:', publishTestError)
      }
    }

    return Response.json({ success: true })
  } catch (err) {
    console.error('[versions/[id]/publish]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
