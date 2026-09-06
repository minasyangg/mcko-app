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

  // Кого можно добавить — больше не грузим здесь: список зависит от состава
  // ИМЕННО этого журнала на момент открытия диалога и от поиска/фильтра по
  // классу, поэтому тянется клиентом по требованию, см.
  // /api/attendance/[id]/available-students.

  return (
    <AttendanceJournalClient
      journalId={journal.id}
      title={journal.title}
      subject={journal.subject}
    />
  )
}
