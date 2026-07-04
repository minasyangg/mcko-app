'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogoutButton } from '@/components/shared/LogoutButton'
import { BookOpen, BookMarked, Users, Monitor, FileText, ClipboardList, BarChart2, TrendingUp, Menu, X, ListChecks, Library } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

const navItems = [
  { href: '/teacher', label: 'Дашборд', icon: BarChart2, exact: true },
  { href: '/teacher/tests', label: 'Тесты', icon: BookOpen },
  { href: '/teacher/library', label: 'Библиотека', icon: Library },
  { href: '/teacher/books', label: 'Книги', icon: BookMarked },
  { href: '/teacher/assignments', label: 'Назначения', icon: ClipboardList },
  { href: '/teacher/monitor', label: 'Мониторинг', icon: Monitor },
  { href: '/teacher/results', label: 'Результаты', icon: TrendingUp },
  { href: '/teacher/groups', label: 'Группы', icon: Users },
  { href: '/teacher/students', label: 'Ученики', icon: Users },
  { href: '/teacher/solution-requests', label: 'Запросы', icon: FileText },
  { href: '/teacher/scoring-rules', label: 'Правила', icon: ListChecks },
]

interface Props {
  fullName: string
  pendingRequests: number
  pendingReview: number
}

function NavLink({
  href,
  label,
  icon: Icon,
  exact,
  badge,
  badgeVariant = 'default',
  onClick,
}: {
  href: string
  label: string
  icon: React.ElementType
  exact?: boolean
  badge?: number
  badgeVariant?: 'default' | 'warning'
  onClick?: () => void
}) {
  const pathname = usePathname()
  const active = exact ? pathname === href : pathname.startsWith(href)

  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2.5 px-3 py-2 text-sm rounded-md mx-2 transition-colors relative',
        active
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
      {badge != null && badge > 0 && (
        <span className={cn(
          'ml-auto inline-flex items-center justify-center rounded-full min-w-4.5 h-4.5 px-1 text-[11px] font-semibold leading-none shrink-0',
          badgeVariant === 'warning'
            ? 'bg-orange-500 text-white'
            : 'bg-destructive text-destructive-foreground'
        )}>
          {badge}
        </span>
      )}
    </Link>
  )
}

function NavList({ pendingRequests, monitorBadge, onLinkClick }: { pendingRequests: number; monitorBadge: number; onLinkClick?: () => void }) {
  return (
    <nav className="flex-1 py-2 space-y-0.5 overflow-y-auto">
      {navItems.map(({ href, label, icon, exact }) => (
        <NavLink
          key={href}
          href={href}
          label={label}
          icon={icon}
          exact={exact}
          badge={
            href === '/teacher/solution-requests' ? pendingRequests :
            href === '/teacher/monitor' ? monitorBadge :
            undefined
          }
          badgeVariant={href === '/teacher/monitor' ? 'warning' : 'default'}
          onClick={onLinkClick}
        />
      ))}
    </nav>
  )
}

export function TeacherNav({ fullName, pendingRequests, pendingReview }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [monitorBadge, setMonitorBadge] = useState(pendingReview)

  useEffect(() => {
    const supabase = createClient()

    const fetchPendingReview = async () => {
      try {
        const res = await fetch('/api/teacher/monitor/pending-count')
        if (!res.ok) return
        const { count } = await res.json()
        setMonitorBadge(count)
      } catch { /* ignore transient errors */ }
    }

    const channel = supabase
      .channel('monitor-badge')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'attempts' }, fetchPendingReview)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attempts' }, fetchPendingReview)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 border-r bg-background flex-col h-screen sticky top-0">
        <div className="h-14 flex items-center px-4 border-b shrink-0">
          <span className="font-semibold text-sm">ExamPlatform</span>
        </div>
        <NavList pendingRequests={pendingRequests} monitorBadge={monitorBadge} />
        <div className="p-4 border-t space-y-1 shrink-0">
          <p className="text-xs text-muted-foreground truncate">{fullName}</p>
          <LogoutButton size="sm" variant="ghost" className="w-full justify-start px-0" />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-background px-4">
        <span className="font-semibold text-sm">ExamPlatform</span>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="p-1.5 rounded-md hover:bg-muted"
          aria-label="Открыть меню"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 w-64 bg-background border-r flex flex-col md:hidden">
            <div className="h-14 flex items-center justify-between px-4 border-b shrink-0">
              <span className="font-semibold text-sm">ExamPlatform</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-md hover:bg-muted"
                aria-label="Закрыть меню"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <NavList
              pendingRequests={pendingRequests}
              monitorBadge={monitorBadge}
              onLinkClick={() => setMobileOpen(false)}
            />
            <div className="p-4 border-t space-y-1 shrink-0">
              <p className="text-xs text-muted-foreground truncate">{fullName}</p>
              <LogoutButton size="sm" variant="ghost" className="w-full justify-start px-0" />
            </div>
          </div>
        </>
      )}
    </>
  )
}
