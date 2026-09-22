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
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Владение заданием, не просто видимость. Раньше здесь был обычный
  // SELECT test_tasks под RLS — тот пропускал и учителя, которому попытка
  // просто РАСШАРЕНА (test_tasks: teacher read via share, 089), не только
  // владельца теста: RLS даёт SELECT читать, а не подтверждает право
  // редактировать. Найдено при добавлении редактирования эталона прямо из
  // AttemptDrawer (2026-09-22) — тот дровер открывается получателю
  // шаринга тоже (в readOnly), и без явной проверки владения этот роут
  // впустил бы его к чужому эталону в обход UI-скрытия кнопки. Тот же
  // хелпер, что уже использует RLS-политика "task_answer_keys: teacher
  // manage own" (018_teacher_scoping.sql).
  if (profile.role === 'admin') {
    const { data: task } = await supabase
      .from('test_tasks')
      .select('id, test_versions!inner(tests!inner(organization_id))')
      .eq('id', taskId)
      .single()
    const taskOrgId = (task?.test_versions as unknown as { tests: { organization_id: string } } | null)?.tests?.organization_id
    if (!task || taskOrgId !== profile.organization_id) {
      return Response.json({ error: 'Task not found' }, { status: 404 })
    }
  } else {
    const { data: owned } = await supabase.rpc('check_task_owned_by_auth', { p_task_id: taskId })
    if (!owned) return Response.json({ error: 'Task not found' }, { status: 404 })
  }

  const body = await request.json() as { correct_answer?: string; grading_method?: string }
  const { correct_answer, grading_method } = body

  // Пустая строка (например Enter сразу после очистки поля в AttemptDrawer)
  // раньше проходила эту проверку и записывалась как "валидный" эталон —
  // а дальше AttemptDrawer скрывает саму кнопку редактирования для пустого
  // correct_answer (falsy-check), делая испорченный эталон неисправимым из
  // того же экрана, который для этого и предназначен.
  if (correct_answer === undefined || correct_answer.trim() === '') {
    return Response.json({ error: 'correct_answer не может быть пустым' }, { status: 400 })
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
