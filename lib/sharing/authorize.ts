import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

// Шаринг сданной работы другому учителю (087_assignment_sharing) — два
// разных допуска: admin настраивает whitelist ученика, сам ученик создаёт/
// отзывает грант на свою сданную работу. См. student_share_settings/
// student_share_recipients/assignment_shares.

export type ShareAdminAuth =
  | { admin: AdminClient; orgId: string }
  | { error: Response }

// Допуск admin к управлению настройками шаринга конкретного ученика — та же
// организация (по образцу authorizeRoadmap/authorizeBookEdit: проверка роли
// через RLS-клиент, запись — через admin-клиент, мимо RLS).
export async function authorizeShareAdmin(
  studentId: string,
  message = 'Нет доступа к настройкам этого ученика'
): Promise<ShareAdminAuth> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin' || !profile.organization_id) {
    return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const admin = createAdminClient()
  const { data: student } = await admin
    .from('profiles').select('id, role, organization_id').eq('id', studentId).single()
  if (!student || student.role !== 'student' || student.organization_id !== profile.organization_id) {
    return { error: Response.json({ error: message }, { status: 404 }) }
  }

  return { admin, orgId: profile.organization_id }
}

export type StudentShareAuth =
  | { admin: AdminClient; studentId: string; ttlDays: number }
  | { error: Response }

// Допуск студента к созданию/отзыву гранта: сам владелец, назначение
// принадлежит ему (лично либо через группу), получатель есть в его
// whitelist (student_share_settings.enabled + student_share_recipients),
// у назначения есть хотя бы одна попытка в терминальном статусе
// (submitted/checked) — черновик (in_progress) не шарится.
export async function authorizeStudentShare(
  assignmentId: string,
  recipientTeacherId: string
): Promise<StudentShareAuth> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'student') {
    return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const admin = createAdminClient()

  // Назначение принадлежит этому ученику — лично (student_id) или через
  // группу (group_id, состоит в group_members). Не через teacher_students —
  // это отдельный, намеренно не связанный канал (019).
  const { data: assignment } = await admin
    .from('assignments')
    .select('id, student_id, group_id')
    .eq('id', assignmentId)
    .single()
  if (!assignment) {
    return { error: Response.json({ error: 'Назначение не найдено' }, { status: 404 }) }
  }

  let owns = assignment.student_id === user.id
  if (!owns && assignment.group_id) {
    const { data: membership } = await admin
      .from('group_members')
      .select('user_id')
      .eq('group_id', assignment.group_id)
      .eq('user_id', user.id)
      .maybeSingle()
    owns = !!membership
  }
  if (!owns) {
    return { error: Response.json({ error: 'Это не ваша работа' }, { status: 403 }) }
  }

  // Whitelist: shared через тот же security-definer хелпер, что и RLS-политики.
  const { data: mayShare } = await supabase.rpc('check_student_may_share_with', {
    p_student_id: user.id,
    p_teacher_id: recipientTeacherId,
  })
  if (!mayShare) {
    return { error: Response.json({ error: 'Этот учитель не разрешён вам администратором' }, { status: 403 }) }
  }

  // Хотя бы одна попытка ученика по этому назначению в терминальном статусе.
  const { data: doneAttempt } = await admin
    .from('attempts')
    .select('id')
    .eq('assignment_id', assignmentId)
    .eq('student_id', user.id)
    .in('status', ['submitted', 'checked'])
    .limit(1)
    .maybeSingle()
  if (!doneAttempt) {
    return { error: Response.json({ error: 'Поделиться можно только сданной работой' }, { status: 409 }) }
  }

  const { data: settings } = await admin
    .from('student_share_settings')
    .select('default_ttl_days')
    .eq('student_id', user.id)
    .single()

  return { admin, studentId: user.id, ttlDays: settings?.default_ttl_days ?? 14 }
}
