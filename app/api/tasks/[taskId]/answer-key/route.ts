import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'
import { buildCompositeAnswerKey } from '@/lib/grading/multi-part-answer'

export async function PATCH(
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

  // Доступ к заданию через user-клиент: RLS пускает учителя только к своим
  // тестам, админа — к тестам организации. Чужое задание → 404.
  const { data: task } = await supabase
    .from('test_tasks').select('id').eq('id', taskId).single()
  if (!task) return Response.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json() as { correct_answer?: string; grading_method?: string }
  const { correct_answer, grading_method } = body

  if (correct_answer === undefined) {
    return Response.json({ error: 'correct_answer required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Автосборка составного ответа по меткам (а)/б)/… — только если учитель
  // не выбрал явно 'manual' (тогда весь ответ намеренно уходит на
  // ручную/ИИ-проверку целиком, без разбиения на части).
  const composite = grading_method !== 'manual'
    ? buildCompositeAnswerKey(correct_answer)
    : { isComposite: false as const, correctAnswerJson: correct_answer }

  // Upsert answer key
  const { error } = await admin.from('task_answer_keys').upsert(
    {
      task_id: taskId,
      correct_answer: composite.correctAnswerJson,
      grading_method: grading_method ?? 'normalized',
      parse_confidence: 1.0,
    },
    { onConflict: 'task_id' }
  )

  if (error) return Response.json({ error: error.message }, { status: 500 })

  if (composite.isComposite && composite.answerParts) {
    await admin.from('test_tasks')
      .update({ task_type: 'composite', answer_parts: composite.answerParts })
      .eq('id', taskId)
  }

  return Response.json({ ok: true })
}
