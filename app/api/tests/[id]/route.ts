import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteVersionStorage } from '@/app/api/parsing/trigger/route'

// PATCH /api/tests/[id] — update test metadata
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: testId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: test } = await supabase
    .from('tests').select('id, organization_id, created_by').eq('id', testId).single()
  if (!test || test.organization_id !== profile.organization_id) {
    return Response.json({ error: 'Test not found' }, { status: 404 })
  }

  // Owner-чек: учитель правит только свои тесты, admin — любые в организации
  if (profile.role !== 'admin' && test.created_by !== user.id) {
    return Response.json({ error: 'Редактировать может только создатель теста или администратор' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))

  type TestUpdate = {
    title?: string
    subject?: string | null
    grade?: string | null
    exam_type?: string | null
    description?: string | null
    scoring_rule_id?: string | null
  }
  const update: TestUpdate = {}

  for (const key of ['subject', 'grade', 'exam_type', 'description'] as const) {
    if (key in body) update[key] = body[key] ? String(body[key]) : null
  }
  if ('title' in body && body.title) update.title = String(body.title)
  if ('scoring_rule_id' in body) update.scoring_rule_id = body.scoring_rule_id || null

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('tests').update(update).eq('id', testId)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

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
      .select('id, organization_id, created_by')
      .eq('id', testId)
      .single()

    if (testError || !test) {
      return Response.json({ error: 'Test not found' }, { status: 404 })
    }

    if (test.organization_id !== profile.organization_id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Owner-чек: учитель удаляет только свои тесты, admin — любые в организации
    if (profile.role !== 'admin' && test.created_by !== user.id) {
      return Response.json({ error: 'Удалять может только создатель теста или администратор' }, { status: 403 })
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

        // Delete task_media storage files, then DB rows
        const { data: mediaRows } = await admin.from('task_media').select('storage_path').in('task_id', taskIds)
        const mediaPaths = (mediaRows ?? []).map(r => r.storage_path).filter(Boolean)
        if (mediaPaths.length) await admin.storage.from('task-media').remove(mediaPaths)
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

      // Delete any remaining Storage files for each version (e.g. unmatched images with task_id=null)
      for (const vId of versionIds) {
        await deleteVersionStorage(admin, vId)
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
