import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { StudentsClient as StudentsTableClient } from '@/components/teacher/StudentsClient'
import { Button } from '@/components/ui/button'
import { Users, Plus, UsersRound } from 'lucide-react'
import Link from 'next/link'

export default async function StudentsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <div>Unauthorized</div>

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'

  // teacher — только закреплённые за ним ученики (M:N teacher_students);
  // RLS сам ограничивает выборку прикреплёнными, доп. фильтр не нужен.
  const { data: students } = await supabase
    .from('profiles')
    .select('id, full_name, grade, is_active, created_at, created_by')
    .eq('role', 'student')
    .eq('organization_id', profile?.organization_id || '')
    .order('is_active', { ascending: false, nullsFirst: false })
    .order('full_name', { ascending: true })

  // Учителя организации — для колонки «Учитель» и переназначения (admin)
  let teachers: { id: string; full_name: string }[] = []
  if (isAdmin) {
    const { data: teacherRows } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'teacher')
      .eq('organization_id', profile?.organization_id || '')
      .order('full_name')
    teachers = teacherRows ?? []
  }

  // Fetch emails from auth using admin client
  const adminClient = createAdminClient()
  const emailMap: Record<string, string> = {}
  if (students?.length) {
    const results = await Promise.all(
      students.map(s => adminClient.auth.admin.getUserById(s.id))
    )
    results.forEach((r, i) => {
      if (r.data.user?.email) emailMap[students[i].id] = r.data.user.email
    })
  }

  const studentsWithEmail = (students ?? []).map(s => ({ ...s, email: emailMap[s.id] ?? '' }))

  const count = studentsWithEmail.length
  const suffix = count % 10 === 1 && count % 100 !== 11 ? '' : count % 10 < 5 && !(count % 100 >= 11 && count % 100 <= 19) ? 'а' : 'ов'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Ученики</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {count} ученик{suffix}
            {!isAdmin && ' (закреплённых за вами)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/teacher/groups">
              <UsersRound className="h-4 w-4 mr-2" />
              Группы
            </Link>
          </Button>
          {isAdmin && (
            <Button asChild>
              <Link href="/teacher/students/new">
                <Plus className="h-4 w-4 mr-2" />
                Добавить ученика
              </Link>
            </Button>
          )}
        </div>
      </div>

      {!studentsWithEmail.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          <Users className="h-10 w-10 opacity-40" />
          <p>
            {isAdmin
              ? 'Нет зарегистрированных учеников.'
              : 'За вами пока не закреплено ни одного ученика. Обратитесь к администратору.'}
          </p>
        </div>
      ) : (
        <StudentsTableClient
          students={studentsWithEmail}
          isAdmin={isAdmin}
          teachers={teachers}
        />
      )}
    </div>
  )
}
