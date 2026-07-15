import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Route } from 'lucide-react'
import { getRoadmapDetail } from '@/lib/roadmaps/progress'
import { ProgramProgressView } from '@/components/teacher/ProgramProgressView'

// Read-only «кабинет» учителя для админа: его программы (road map) по
// предметам, темы с привязанными ДЗ/тестами и прогресс учеников. Расчёт
// прогресса — общий helper lib/roadmaps/progress.ts (тот же источник правды,
// что и в Мониторинге учителя: student_final_results + attempts, а не только
// грубое checked/не-checked, как было раньше).
export default async function TeacherCabinetPage({ params }: { params: Promise<{ teacherId: string }> }) {
  const { teacherId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase.from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!me || me.role !== 'admin' || !me.organization_id) redirect('/teacher')

  const admin = createAdminClient()
  const { data: teacher } = await admin
    .from('profiles').select('id, full_name, role, organization_id').eq('id', teacherId).single()
  if (!teacher || teacher.role !== 'teacher' || teacher.organization_id !== me.organization_id) notFound()

  const { data: roadmapRows } = await admin
    .from('roadmaps').select('id, title, subject').eq('created_by', teacherId).order('subject').order('title')

  const details = (
    await Promise.all((roadmapRows ?? []).map(r => getRoadmapDetail(admin, r.id)))
  ).filter((d): d is NonNullable<typeof d> => !!d)

  const bySubject = new Map<string, typeof details>()
  for (const d of details) {
    const subj = d.subject?.trim() || 'Без предмета'
    const arr = bySubject.get(subj) ?? []
    arr.push(d)
    bySubject.set(subj, arr)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <Button asChild variant="ghost" size="sm" className="h-7 -ml-2 px-2 text-muted-foreground">
          <Link href="/teacher/users"><ArrowLeft className="h-3.5 w-3.5 mr-1" /> К пользователям</Link>
        </Button>
        <h1 className="text-2xl font-semibold">Кабинет: {teacher.full_name}</h1>
        <p className="text-sm text-muted-foreground">Программы учителя, темы и прогресс учеников (только просмотр)</p>
      </div>

      {details.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center text-muted-foreground">
          <Route className="h-10 w-10 opacity-40" />
          <p>У этого учителя пока нет программ.</p>
        </div>
      ) : (
        [...bySubject.entries()].map(([subject, programs]) => (
          <section key={subject} className="space-y-3">
            <h2 className="text-lg font-semibold border-b pb-1">{subject}</h2>
            {programs.map(program => (
              <div key={program.id} className="rounded-md border">
                <div className="px-4 py-2.5 border-b bg-muted/30 font-medium">{program.title}</div>
                <div className="p-3">
                  <ProgramProgressView program={program} readOnly />
                </div>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  )
}
