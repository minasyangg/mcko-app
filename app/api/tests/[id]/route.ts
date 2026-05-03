import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: testId } = await params
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
      .select('role, organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile || !['teacher', 'admin'].includes(profile.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Verify the test belongs to the teacher's organization
    const { data: test, error: testError } = await supabase
      .from('tests')
      .select('id, organization_id')
      .eq('id', testId)
      .single()

    if (testError || !test) {
      return Response.json({ error: 'Test not found' }, { status: 404 })
    }

    if (test.organization_id !== profile.organization_id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const admin = createAdminClient()

    // Get all versions for this test
    const { data: versions } = await admin
      .from('test_versions')
      .select('id')
      .eq('test_id', testId)

    const versionIds = (versions ?? []).map((v) => v.id)

    if (versionIds.length > 0) {
      // Get all tasks for these versions
      const { data: tasks } = await admin
        .from('test_tasks')
        .select('id')
        .in('test_version_id', versionIds)

      const taskIds = (tasks ?? []).map((t) => t.id)

      if (taskIds.length > 0) {
        // Delete task_answer_keys
        await admin.from('task_answer_keys').delete().in('task_id', taskIds)

        // Delete task_solutions (and their media via cascade or explicit)
        const { data: solutions } = await admin
          .from('task_solutions')
          .select('id')
          .in('task_id', taskIds)

        const solutionIds = (solutions ?? []).map((s) => s.id)
        if (solutionIds.length > 0) {
          await admin.from('solution_media').delete().in('solution_id', solutionIds)
          await admin.from('task_solutions').delete().in('id', solutionIds)
        }

        // Delete task_media
        await admin.from('task_media').delete().in('task_id', taskIds)

        // Delete solution_requests
        await admin.from('solution_requests').delete().in('task_id', taskIds)

        // Delete parsing_warnings for tasks
        await admin.from('parsing_warnings').delete().in('task_id', taskIds)

        // Delete attempt_task_answers
        await admin.from('attempt_task_answers').delete().in('task_id', taskIds)

        // Delete test_tasks
        await admin.from('test_tasks').delete().in('id', taskIds)
      }

      // Delete parsing_warnings for parsing_jobs of these versions
      const { data: jobs } = await admin
        .from('parsing_jobs')
        .select('id')
        .in('test_version_id', versionIds)

      const jobIds = (jobs ?? []).map((j) => j.id)
      if (jobIds.length > 0) {
        await admin.from('parsing_warnings').delete().in('parsing_job_id', jobIds)
        await admin.from('parsing_jobs').delete().in('id', jobIds)
      }

      // Delete test_documents
      await admin.from('test_documents').delete().in('test_version_id', versionIds)

      // Get assignments for these versions
      const { data: assignments } = await admin
        .from('assignments')
        .select('id')
        .in('test_version_id', versionIds)

      const assignmentIds = (assignments ?? []).map((a) => a.id)
      if (assignmentIds.length > 0) {
        // Delete attempts for these assignments
        const { data: attempts } = await admin
          .from('attempts')
          .select('id')
          .in('assignment_id', assignmentIds)

        const attemptIds = (attempts ?? []).map((a) => a.id)
        if (attemptIds.length > 0) {
          await admin.from('attempt_task_answers').delete().in('attempt_id', attemptIds)
          await admin.from('presence_events').delete().in('attempt_id', attemptIds)
          await admin.from('attempts').delete().in('id', attemptIds)
        }

        await admin.from('assignments').delete().in('id', assignmentIds)
      }

      // Delete test_versions
      await admin.from('test_versions').delete().in('id', versionIds)
    }

    // Finally delete the test itself
    const { error: deleteError } = await admin
      .from('tests')
      .delete()
      .eq('id', testId)

    if (deleteError) {
      return Response.json({ error: deleteError.message }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/tests/[id]]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
