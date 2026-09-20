import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { StudentSharePermissionsClient } from '@/components/teacher/StudentSharePermissionsClient'

// Настройка "кому из учеников разрешено делиться сданными работами с другими
// учителями, и с кем именно" — только admin. Ученик решает сам, что и с кем
// расшарить (кнопка на карточке сданной работы), но САМА возможность и
// whitelist получателей задаёт админ — по образцу books/permissions.
export default async function StudentSharePermissionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') redirect('/teacher/students')

  const org = profile.organization_id || ''

  const [{ data: students }, { data: teachers }, { data: settings }, { data: recipients }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, grade')
      .eq('role', 'student')
      .eq('organization_id', org)
      .order('full_name'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'teacher')
      .eq('organization_id', org)
      .order('full_name'),
    supabase.from('student_share_settings').select('student_id, enabled, default_ttl_days'),
    supabase.from('student_share_recipients').select('student_id, teacher_id'),
  ])

  const settingsByStudent = new Map((settings ?? []).map(s => [s.student_id, s]))
  const recipientsByStudent = new Map<string, string[]>()
  for (const r of recipients ?? []) {
    const arr = recipientsByStudent.get(r.student_id) ?? []
    arr.push(r.teacher_id)
    recipientsByStudent.set(r.student_id, arr)
  }

  const studentsWithSettings = (students ?? []).map(s => {
    const settingsRow = settingsByStudent.get(s.id)
    return {
      id: s.id,
      full_name: s.full_name,
      grade: s.grade,
      enabled: settingsRow?.enabled ?? false,
      default_ttl_days: settingsRow?.default_ttl_days ?? 14,
      recipient_ids: recipientsByStudent.get(s.id) ?? [],
    }
  })

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="h-7 -ml-2 px-2 text-muted-foreground">
          <Link href="/teacher/students"><ArrowLeft className="h-3.5 w-3.5 mr-1" /> К ученикам</Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Шаринг работ между учителями</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ученик сам решает, с кем поделиться сданной работой, но кому именно можно
            делиться — и с какими учителями — задаётся здесь.
          </p>
        </div>
      </div>

      <StudentSharePermissionsClient students={studentsWithSettings} teachers={teachers ?? []} />
    </div>
  )
}
