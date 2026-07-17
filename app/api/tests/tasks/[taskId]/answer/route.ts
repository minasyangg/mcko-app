import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildCompositeAnswerKey } from '@/lib/grading/multi-part-answer'

export async function PUT(
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
    const { correct_answer, grading_method } = body

    if (correct_answer === undefined) {
      return Response.json({ error: 'correct_answer is required' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Автосборка составного ответа по меткам (а)/б)/… — только если учитель
    // не выбрал явно 'manual' (тогда весь ответ намеренно уходит на
    // ручную/ИИ-проверку целиком, без разбиения на части).
    const composite = grading_method !== 'manual' && typeof correct_answer === 'string'
      ? buildCompositeAnswerKey(correct_answer)
      : { isComposite: false as const, correctAnswerJson: correct_answer }

    // Check if answer key exists
    const { data: existing } = await admin
      .from('task_answer_keys')
      .select('id')
      .eq('task_id', taskId)
      .single()

    let result
    if (existing) {
      const { data, error } = await admin
        .from('task_answer_keys')
        .update({
          correct_answer: composite.correctAnswerJson,
          grading_method: grading_method ?? 'normalized',
        })
        .eq('task_id', taskId)
        .select()
        .single()

      if (error) {
        return Response.json({ error: error.message }, { status: 500 })
      }
      result = data
    } else {
      const { data, error } = await admin
        .from('task_answer_keys')
        .insert({
          task_id: taskId,
          correct_answer: composite.correctAnswerJson,
          grading_method: grading_method ?? 'normalized',
        })
        .select()
        .single()

      if (error) {
        return Response.json({ error: error.message }, { status: 500 })
      }
      result = data
    }

    if (composite.isComposite && composite.answerParts) {
      await admin.from('test_tasks')
        .update({ task_type: 'composite', answer_parts: composite.answerParts })
        .eq('id', taskId)
    }

    return Response.json(result)
  } catch (err) {
    console.error('[PUT /api/tests/tasks/[taskId]/answer]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
