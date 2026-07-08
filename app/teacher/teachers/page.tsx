import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { TeachersClient } from '@/components/teacher/TeachersClient'

// Управление учителями — только admin. Создание учителей и множественное
// закрепление учеников за учителем.
export default async function TeachersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') redirect('/teacher')

  const org = profile.organization_id || ''

  const [{ data: teachers }, { data: students }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, is_active, created_at')
      .eq('role', 'teacher')
      .eq('organization_id', org)
      .order('full_name'),
    supabase
      .from('profiles')
      .select('id, full_name, grade, created_by, is_active')
      .eq('role', 'student')
      .eq('organization_id', org)
      .order('full_name'),
  ])

  // Emails учителей — через admin client (в profiles их нет)
  const adminClient = createAdminClient()
  const emailMap: Record<string, string> = {}
  if (teachers?.length) {
    const results = await Promise.all(teachers.map(t => adminClient.auth.admin.getUserById(t.id)))
    results.forEach((r, i) => {
      if (r.data.user?.email) emailMap[teachers[i].id] = r.data.user.email
    })
  }

  const teachersWithMeta = (teachers ?? []).map(t => ({
    id: t.id,
    full_name: t.full_name,
    is_active: t.is_active,
    email: emailMap[t.id] ?? '',
    student_count: (students ?? []).filter(s => s.created_by === t.id).length,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Учителя</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Создание учителей и закрепление за ними учеников
        </p>
      </div>
      <TeachersClient
        teachers={teachersWithMeta}
        students={(students ?? []).map(s => ({
          id: s.id,
          full_name: s.full_name,
          grade: s.grade,
          created_by: s.created_by,
          is_active: s.is_active,
        }))}
      />
    </div>
  )
}
