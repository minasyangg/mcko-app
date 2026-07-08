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

  const [{ data: studentRows }, { data: teacherRows }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, grade, is_active, created_at, created_by')
      .eq('role', 'student')
      .eq('organization_id', org)
      .order('is_active', { ascending: false, nullsFirst: false })
      .order('full_name'),
    supabase
      .from('profiles')
      .select('id, full_name, is_active, created_at')
      .eq('role', 'teacher')
      .eq('organization_id', org)
      .order('full_name'),
  ])

  const students = studentRows ?? []
  const teachers = teacherRows ?? []

  // Emails — из auth (в profiles их нет), одним проходом по всем id
  const adminClient = createAdminClient()
  const emailMap: Record<string, string> = {}
  const allIds = [...students.map(s => s.id), ...teachers.map(t => t.id)]
  if (allIds.length) {
    const results = await Promise.all(allIds.map(id => adminClient.auth.admin.getUserById(id)))
    results.forEach((r, i) => {
      if (r.data.user?.email) emailMap[allIds[i]] = r.data.user.email
    })
  }

  const studentsWithEmail = students.map(s => ({ ...s, email: emailMap[s.id] ?? '' }))
  const teachersWithMeta = teachers.map(t => ({
    id: t.id,
    full_name: t.full_name,
    is_active: t.is_active,
    email: emailMap[t.id] ?? '',
    student_count: students.filter(s => s.created_by === t.id).length,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Пользователи</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ученики и учителя организации
        </p>
      </div>
      <UsersClient students={studentsWithEmail} teachers={teachersWithMeta} />
    </div>
  )
}
