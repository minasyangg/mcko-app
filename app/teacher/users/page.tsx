import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { UsersClient } from '@/components/teacher/UsersClient'

// Единая админ-панель пользователей: ученики + учителя на одной странице,
// одна кнопка создания (выбор роли), карточки различаются по роли. Только admin.
export default async function UsersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') redirect('/teacher')

  const org = profile.organization_id || ''

  const [{ data: studentRows }, { data: teacherRows }, { data: links }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, grade, is_active, created_at, created_by, email, telegram_username')
      .eq('role', 'student')
      .eq('organization_id', org)
      .order('is_active', { ascending: false, nullsFirst: false })
      .order('full_name'),
    supabase
      .from('profiles')
      .select('id, full_name, is_active, created_at, email')
      .eq('role', 'teacher')
      .eq('organization_id', org)
      .order('full_name'),
    supabase.from('teacher_students').select('teacher_id, student_id'),
  ])

  const students = studentRows ?? []
  const teachers = teacherRows ?? []

  // Прикрепления M:N: ученик → id учителей и счётчик учеников на учителя
  const teachersByStudent = new Map<string, string[]>()
  const countByTeacher = new Map<string, number>()
  for (const l of links ?? []) {
    const arr = teachersByStudent.get(l.student_id) ?? []
    arr.push(l.teacher_id)
    teachersByStudent.set(l.student_id, arr)
    countByTeacher.set(l.teacher_id, (countByTeacher.get(l.teacher_id) ?? 0) + 1)
  }

  // email теперь живёт в profiles (миграция 025) — Auth Admin API не нужен
  const studentsWithEmail = students.map(s => ({
    ...s,
    email: s.email ?? '',
    teacher_ids: teachersByStudent.get(s.id) ?? [],
  }))
  const teachersWithMeta = teachers.map(t => ({
    id: t.id,
    full_name: t.full_name,
    is_active: t.is_active,
    email: t.email ?? '',
    student_count: countByTeacher.get(t.id) ?? 0,
  }))

  // Заявки с публичной регистрации (миграция 054).
  //
  // Читаем admin-клиентом СОЗНАТЕЛЬНО: у заявки organization_id ещё пуст —
  // организацию назначает админ в момент одобрения. Политика
  // «profiles: admin read org» требует organization_id = auth_org(), поэтому
  // под обычным клиентом такие строки не видны вообще, и таб модерации
  // оставался пустым при живых заявках в базе.
  // Доступ безопасен: страница уже отсечена проверкой role === 'admin' выше.
  const adminClient = createAdminClient()
  const { data: pending } = await adminClient
    .from('profiles')
    .select('id, full_name, email, telegram_username, phone, pd_consent_at, created_at')
    .eq('moderation_status', 'pending')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Пользователи</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ученики и учителя организации
        </p>
      </div>
      <UsersClient students={studentsWithEmail} teachers={teachersWithMeta} pending={pending ?? []} />
    </div>
  )
}
