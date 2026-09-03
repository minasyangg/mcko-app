'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogoutButton } from '@/components/shared/LogoutButton'
import { SwitchAccountButton } from '@/components/shared/SwitchAccountButton'
import { BookOpen, BookMarked, Users, GraduationCap, Monitor, FileText, BarChart2, TrendingUp, Menu, X, ListChecks, Library, Route, Bell, Settings, PenLine, ChevronDown, ClipboardCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

interface NavItem {
  href: string
  label: string
  /** У подпунктов групп иконки нет — их различает подпись, а не значок */
  icon?: React.ElementType
  exact?: boolean
  adminOnly?: boolean
  teacherOnly?: boolean
  /** Подпункты: пункт становится раскрывающейся группой, сам по себе не ссылка */
  children?: NavItem[]
}

const navItems: NavItem[] = [
  { href: '/teacher', label: 'Дашборд', icon: BarChart2, exact: true },
  // «Мои задания» — группа: собственные тесты/ДЗ и учебные программы.
  // Программы раньше были отдельным пунктом меню, но по смыслу это тот же
  // собственный учебный материал учителя, только сгруппированный по темам.
  {
    href: '/teacher/tests', label: 'Мои задания', icon: BookOpen, teacherOnly: true,
    children: [
      { href: '/teacher/tests',    label: 'Тесты/ДЗ' },
      { href: '/teacher/roadmaps', label: 'Программы' },
    ],
  },
  // У админа программ нет (они всегда чьи-то), поэтому для него — обычная ссылка
  { href: '/teacher/tests', label: 'Мои задания', icon: BookOpen, adminOnly: true },
  // «Библиотека» — не ссылка, а группа из двух каталогов: банк задач ОГЭ/ЕГЭ
  // (library_problems) и учебники (books). Раньше это были два независимых
  // пункта меню, из-за чего «Библиотека» читалась как что-то одно конкретное.
  {
    href: '/teacher/library', label: 'Библиотека', icon: Library,
    children: [
      { href: '/teacher/library', label: 'ОГЭ/ЕГЭ' },
      { href: '/teacher/books',   label: 'Книги' },
    ],
  },
  { href: '/teacher/monitor', label: 'Мониторинг', icon: Monitor },
  { href: '/teacher/results', label: 'Результаты', icon: TrendingUp },
  // admin: единая панель пользователей; teacher: только свои ученики (read-only)
  // «Группы» — внутри «Ученики»/«Пользователи» (ссылка в шапке), не в меню
  { href: '/teacher/users', label: 'Пользователи', icon: GraduationCap, adminOnly: true },
  // Журналы посещаемости — отдельно от «Мониторинга»: там результаты тестов,
  // здесь учёт присутствия на очных занятиях
  { href: '/teacher/attendance', label: 'Посещение', icon: ClipboardCheck },
  { href: '/teacher/students', label: 'Ученики', icon: Users, teacherOnly: true },
  // доски заводятся здесь, а не кнопкой напротив ученика: у пары их может быть
  // несколько, по одной на предмет
  { href: '/teacher/doska', label: 'Доски', icon: PenLine, teacherOnly: true },
  { href: '/teacher/solution-requests', label: 'Запросы', icon: FileText },
  { href: '/teacher/scoring-rules', label: 'Правила', icon: ListChecks },
  // настройка событий telegram/email-уведомлений организации
  { href: '/teacher/notifications', label: 'Уведомления', icon: Bell, adminOnly: true },
]

interface Props {
  fullName: string
  isAdmin?: boolean
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
  icon?: React.ElementType
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
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
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

// Раскрывающаяся группа пунктов («Библиотека» → ОГЭ/ЕГЭ, Книги). Открыта,
// пока активен любой из её подпунктов, — чтобы после перехода раздел не
// схлопывался и было видно, где ты находишься.
function NavGroup({ item, onLinkClick }: { item: NavItem; onLinkClick?: () => void }) {
  const pathname = usePathname()
  const children = item.children ?? []
  const childActive = children.some(c => pathname.startsWith(c.href))
  const [open, setOpen] = useState(childActive)

  useEffect(() => { if (childActive) setOpen(true) }, [childActive])

  const Icon = item.icon
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2.5 px-3 py-2 text-sm rounded-md mx-2 transition-colors',
          'w-[calc(100%-1rem)]',
          childActive
            ? 'text-primary font-medium'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        )}
      >
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        <span className="truncate">{item.label}</span>
        <ChevronDown className={cn('ml-auto h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5 pl-4">
          {children.map(c => (
            <NavLink key={c.href} href={c.href} label={c.label} icon={c.icon} onClick={onLinkClick} />
          ))}
        </div>
      )}
    </div>
  )
}

function NavList({ isAdmin, pendingRequests, monitorBadge, onLinkClick }: { isAdmin: boolean; pendingRequests: number; monitorBadge: number; onLinkClick?: () => void }) {
  return (
    <nav className="flex-1 py-2 space-y-0.5 overflow-y-auto">
      {navItems.filter(item => (!item.adminOnly || isAdmin) && (!item.teacherOnly || !isAdmin)).map((item) => (
        item.children ? (
          <NavGroup key={item.href} item={item} onLinkClick={onLinkClick} />
        ) : (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            exact={item.exact}
            badge={
              item.href === '/teacher/solution-requests' ? pendingRequests :
              item.href === '/teacher/monitor' ? monitorBadge :
              undefined
            }
            badgeVariant={item.href === '/teacher/monitor' ? 'warning' : 'default'}
            onClick={onLinkClick}
          />
        )
      ))}
    </nav>
  )
}

export function TeacherNav({ fullName, isAdmin = false, pendingRequests, pendingReview }: Props) {
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
        <NavList isAdmin={isAdmin} pendingRequests={pendingRequests} monitorBadge={monitorBadge} />
        <div className="p-4 border-t space-y-1 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground truncate">{fullName}</p>
            <SwitchAccountButton variant="inline" />
          </div>
          <Link
            href="/teacher/settings"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            <Settings className="h-3.5 w-3.5" />
            Настройки
          </Link>
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
              isAdmin={isAdmin}
              pendingRequests={pendingRequests}
              monitorBadge={monitorBadge}
              onLinkClick={() => setMobileOpen(false)}
            />
            <div className="p-4 border-t space-y-1 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground truncate">{fullName}</p>
                <SwitchAccountButton variant="inline" />
              </div>
              <Link
                href="/teacher/settings"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
              >
                <Settings className="h-3.5 w-3.5" />
                Настройки
              </Link>
              <LogoutButton size="sm" variant="ghost" className="w-full justify-start px-0" />
            </div>
          </div>
        </>
      )}
    </>
  )
}
