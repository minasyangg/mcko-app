import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BookOpen, Users, ClipboardList, MessageSquare, History } from 'lucide-react'
import Link from 'next/link'

export default async function TeacherDashboard() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = user
    ? await supabase.from('profiles').select('role').eq('id', user.id).single()
    : { data: null }
  const isAdmin = me?.role === 'admin'

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const [
    { count: testsCount },
    { count: activeAttempts },
    { count: pendingRequests },
    { count: studentsCount },
    { count: loginsToday },
  ] = await Promise.all([
    supabase.from('tests').select('*', { count: 'exact', head: true }),
    supabase.from('attempts').select('*', { count: 'exact', head: true }).eq('status', 'in_progress'),
    supabase.from('solution_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'student'),
    isAdmin
      ? supabase.from('login_events').select('*', { count: 'exact', head: true }).gte('created_at', dayAgo)
      : Promise.resolve({ count: null }),
  ])

  const stats = [
    { label: 'Тестов', value: testsCount ?? 0, icon: BookOpen, href: '/teacher/tests' },
    { label: 'Активных попыток', value: activeAttempts ?? 0, icon: ClipboardList, href: '/teacher/monitor' },
    { label: 'Учеников', value: studentsCount ?? 0, icon: Users, href: '/teacher/students' },
    { label: 'Запросов решений', value: pendingRequests ?? 0, icon: MessageSquare, href: '/teacher/solution-requests' },
    // Журнал входов — только админу (карточка ведёт на /teacher/sessions)
    ...(isAdmin ? [{ label: 'Сессии за сутки', value: loginsToday ?? 0, icon: History, href: '/teacher/sessions' }] : []),
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Дашборд</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, href }) => (
          <Link key={href} href={href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{value}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
