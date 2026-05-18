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

  const [{ count: pendingRequests }, { count: pendingReview }] = await Promise.all([
    supabase
      .from('solution_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('attempts')
      .select('*', { count: 'exact', head: true })
      .in('status', ['submitted', 'under_review']),
  ])

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
