import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-user'

// Права на действия учителя над конкретным назначением (завершение, добавление
// попыток): учитель распоряжается своими назначениями, админ — любыми в
// организации. Мониторинг показывает учителю и чужие назначения его учеников
// (RLS из 018 разрешает читать попытки своих учеников), поэтому владение
// проверяем явно, а не полагаемся на видимость.
export async function authorizeAssignmentOwner(
  assignmentId: string,
  forbiddenMessage = 'Изменить назначение может только его создатель или администратор'
) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await getAuthUser(supabase)
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const admin = createAdminClient()
  const { data: assignment } = await admin
    .from('assignments')
    .select('id, organization_id, created_by, student_id, group_id')
    .eq('id', assignmentId)
    .single()

  if (!assignment || assignment.organization_id !== profile.organization_id) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  if (profile.role !== 'admin' && assignment.created_by !== user.id) {
    return { error: NextResponse.json({ error: forbiddenMessage }, { status: 403 }) }
  }

  return { admin, userId: user.id, assignment }
}
