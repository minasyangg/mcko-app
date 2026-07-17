import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const { versionId } = await params
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

    // Verify the version exists and is not published
    const { data: version, error: versionError } = await supabase
      .from('test_versions')
      .select('id, status')
      .eq('id', versionId)
      .single()

    if (versionError || !version) {
      return Response.json({ error: 'Version not found' }, { status: 404 })
    }

    if (version.status === 'published') {
      return Response.json({ error: 'Cannot modify a published version' }, { status: 422 })
    }

    const body = await request.json()
    const {
      task_number,
      prompt_text,
      prompt_html,
      task_type,
      options,
      answer_format_hint,
      max_score,
      correct_answer,
      grading_method,
    } = body

    if (!prompt_text || typeof prompt_text !== 'string') {
      return Response.json({ error: 'prompt_text is required' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: task, error: insertError } = await admin
      .from('test_tasks')
      .insert({
        test_version_id: versionId,
        task_number: task_number ?? 1,
        sort_order: task_number ?? 1,
        prompt_text,
        prompt_html: prompt_html ?? null,
        task_type: task_type ?? 'free_response',
        options: options ?? null,
        answer_format_hint: answer_format_hint ?? null,
        max_score: max_score ?? 1,
        review_status: 'approved',
      })
      .select()
      .single()

    if (insertError || !task) {
      return Response.json({ error: insertError?.message ?? 'Failed to create task' }, { status: 500 })
    }

    // Create answer key if correct_answer was provided
    if (correct_answer !== undefined && correct_answer !== null && correct_answer !== '') {
      await admin.from('task_answer_keys').insert({
        task_id: task.id,
        correct_answer: correct_answer,
        grading_method: grading_method ?? 'normalized',
      })
    }

    // Re-fetch with answer key
    const { data: taskWithKey } = await admin
      .from('test_tasks')
      .select('*, task_answer_keys(correct_answer, grading_method)')
      .eq('id', task.id)
      .single()

    const answerKey = (taskWithKey as any)?.task_answer_keys

    return Response.json({
      ...task,
      correct_answer: answerKey ? String(answerKey.correct_answer ?? '') : null,
      grading_method: answerKey?.grading_method ?? null,
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/tests/versions/[versionId]/tasks]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
