import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AttendanceListClient, type JournalRow } from '@/components/teacher/AttendanceListClient'

// Журналы посещаемости. Видимость — на RLS (attendance_journals: owner or
// admin): учитель видит свои журналы, админ — все в организации.
export default async function AttendancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) redirect('/teacher')

  const { data } = await supabase
    .from('attendance_journals')
    .select('id, title, subject, created_at')
    .order('created_at', { ascending: false })

  return <AttendanceListClient journals={(data ?? []) as JournalRow[]} />
}
