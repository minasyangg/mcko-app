import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

type TaskUpdate = Database['public']['Tables']['test_tasks']['Update']

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params
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

    // Verify task exists and version is not published
    const { data: task, error: taskError } = await supabase
      .from('test_tasks')
      .select('id, test_version_id')
      .eq('id', taskId)
      .single()

    if (taskError || !task) {
      return Response.json({ error: 'Task not found' }, { status: 404 })
    }

    if (task.test_version_id) {
      const { data: version } = await supabase
        .from('test_versions')
        .select('status')
        .eq('id', task.test_version_id)
        .single()

      if (version?.status === 'published') {
        return Response.json({ error: 'Cannot modify tasks in a published version' }, { status: 422 })
      }
    }

    const body = await request.json()
    const { prompt_text, task_type, options, answer_format_hint, max_score, review_status } = body

    const updateData: TaskUpdate = {}
    if (prompt_text !== undefined) updateData.prompt_text = prompt_text
    if (task_type !== undefined) updateData.task_type = task_type
    if (options !== undefined) updateData.options = options
    if (answer_format_hint !== undefined) updateData.answer_format_hint = answer_format_hint
    if (max_score !== undefined) updateData.max_score = max_score
    if (review_status !== undefined) updateData.review_status = review_status

    const admin = createAdminClient()

    const { data: updated, error: updateError } = await admin
      .from('test_tasks')
      .update(updateData)
      .eq('id', taskId)
      .select()
      .single()

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 })
    }

    return Response.json(updated)
  } catch (err) {
    console.error('[PATCH /api/tests/tasks/[taskId]]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params
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

    const { data: task, error: taskError } = await supabase
      .from('test_tasks')
      .select('id, test_version_id')
      .eq('id', taskId)
      .single()

    if (taskError || !task) {
      return Response.json({ error: 'Task not found' }, { status: 404 })
    }

    if (task.test_version_id) {
      const { data: version } = await supabase
        .from('test_versions')
        .select('status')
        .eq('id', task.test_version_id)
        .single()

      if (version?.status === 'published') {
        return Response.json({ error: 'Cannot delete tasks in a published version' }, { status: 422 })
      }
    }

    const admin = createAdminClient()

    // Cascade: answer keys, solutions (and their media), task media, solution_requests, parsing_warnings, attempt_task_answers
    await admin.from('task_answer_keys').delete().eq('task_id', taskId)

    const { data: solutions } = await admin
      .from('task_solutions')
      .select('id')
      .eq('task_id', taskId)

    const solutionIds = (solutions ?? []).map((s) => s.id)
    if (solutionIds.length > 0) {
      await admin.from('solution_media').delete().in('solution_id', solutionIds)
      await admin.from('task_solutions').delete().in('id', solutionIds)
    }

    await admin.from('task_media').delete().eq('task_id', taskId)
    await admin.from('solution_requests').delete().eq('task_id', taskId)
    await admin.from('parsing_warnings').delete().eq('task_id', taskId)
    await admin.from('attempt_task_answers').delete().eq('task_id', taskId)

    const { error: deleteError } = await admin
      .from('test_tasks')
      .delete()
      .eq('id', taskId)

    if (deleteError) {
      return Response.json({ error: deleteError.message }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/tests/tasks/[taskId]]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
