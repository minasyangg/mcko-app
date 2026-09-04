import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { AttendanceJournalClient } from '@/components/teacher/AttendanceJournalClient'

export default async function AttendanceJournalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) redirect('/teacher')

  // RLS решает доступ: невидимый журнал = отсутствующий
  const { data: journal } = await supabase
    .from('attendance_journals')
    .select('id, title, subject')
    .eq('id', id)
    .maybeSingle()
  if (!journal) notFound()

  // Кого можно добавить в журнал. Учителю RLS отдаёт только его учеников,
  // админу — всех в организации; отдельного фильтра здесь не ставим, иначе
  // продублируем правило доступа в двух местах.
  const { data: students } = await supabase
    .from('profiles')
    .select('id, full_name, grade')
    .eq('role', 'student')
    .is('deleted_at', null)
    .order('full_name')

  return (
    <AttendanceJournalClient
      journalId={journal.id}
      title={journal.title}
      subject={journal.subject}
      availableStudents={students ?? []}
    />
  )
}
