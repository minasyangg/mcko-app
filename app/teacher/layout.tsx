import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/components/shared/LogoutButton'
import { BookOpen, Users, Monitor, FileText, ClipboardList, BarChart2 } from 'lucide-react'

const navItems = [
  { href: '/teacher', label: 'Дашборд', icon: BarChart2, exact: true },
  { href: '/teacher/tests', label: 'Тесты', icon: BookOpen },
  { href: '/teacher/assignments', label: 'Назначения', icon: ClipboardList },
  { href: '/teacher/monitor', label: 'Мониторинг', icon: Monitor },
  { href: '/teacher/groups', label: 'Группы', icon: Users },
  { href: '/teacher/solution-requests', label: 'Запросы', icon: FileText },
]

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'teacher' && profile?.role !== 'admin') redirect('/student')

  const { count: pendingRequests } = await supabase
    .from('solution_requests')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r bg-background flex flex-col">
        <div className="h-14 flex items-center px-4 border-b">
          <span className="font-semibold text-sm">ExamPlatform</span>
        </div>
        <nav className="flex-1 py-2">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-sm mx-2 relative"
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
              {href === '/teacher/solution-requests' && (pendingRequests ?? 0) > 0 && (
                <span className="ml-auto text-xs bg-destructive text-destructive-foreground rounded-full px-1.5 py-0.5 leading-none">
                  {pendingRequests}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t space-y-1">
          <p className="text-xs text-muted-foreground truncate">{profile.full_name}</p>
          <LogoutButton size="sm" variant="ghost" className="w-full justify-start px-0" />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 p-6">{children}</main>
    </div>
  )
}
