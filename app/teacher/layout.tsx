import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TeacherNav } from '@/components/teacher/TeacherNav'

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/no-profile')
  if (profile.role !== 'teacher' && profile.role !== 'admin') redirect('/student')

  const [{ count: pendingRequests }, { data: completedAttempts }] = await Promise.all([
    supabase
      .from('solution_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('attempts')
      .select('student_id, assignment_id, status, last_activity_at')
      .in('status', ['submitted', 'under_review', 'checked'])
      .order('last_activity_at', { ascending: false })
      .limit(1000),
  ])

  // Count groups where the LATEST attempt needs review (matches MonitorTable "На проверке" tab)
  const latestByGroup = new Map<string, string>()
  for (const a of completedAttempts ?? []) {
    const key = `${a.student_id}:${a.assignment_id}`
    if (!latestByGroup.has(key)) latestByGroup.set(key, a.status)
  }
  const pendingReview = [...latestByGroup.values()]
    .filter(s => s === 'submitted' || s === 'under_review').length

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <TeacherNav
        fullName={profile.full_name ?? ''}
        pendingRequests={pendingRequests ?? 0}
        pendingReview={pendingReview ?? 0}
      />
      <main className="flex-1 min-w-0 p-4 md:p-6">{children}</main>
    </div>
  )
}
