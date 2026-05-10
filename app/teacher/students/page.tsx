import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { StudentsClient as StudentsTableClient } from '@/components/teacher/StudentsClient'
import { Button } from '@/components/ui/button'
import { Users, Plus } from 'lucide-react'
import Link from 'next/link'

export default async function StudentsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <div>Unauthorized</div>

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  const { data: students } = await supabase
    .from('profiles')
    .select('id, full_name, grade, is_active, created_at')
    .eq('role', 'student')
    .eq('organization_id', profile?.organization_id || '')
    .order('is_active', { ascending: false, nullsFirst: false })
    .order('full_name', { ascending: true })

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
          <p className="text-sm text-muted-foreground mt-1">{count} ученик{suffix}</p>
        </div>
        <Button asChild>
          <Link href="/teacher/students/new">
            <Plus className="h-4 w-4 mr-2" />
            Добавить ученика
          </Link>
        </Button>
      </div>

      {!studentsWithEmail.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          <Users className="h-10 w-10 opacity-40" />
          <p>Нет зарегистрированных учеников.</p>
        </div>
      ) : (
        <StudentsTableClient students={studentsWithEmail} />
      )}
    </div>
  )
}
