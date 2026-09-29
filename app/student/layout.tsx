import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/components/shared/LogoutButton'
import { StudentNav } from '@/components/student/StudentNav'
import { Settings } from 'lucide-react'
import { getAuthUser } from '@/lib/supabase/auth-user'

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/no-profile')
  if (profile.role !== 'student') redirect('/teacher')

  return (
    <div className="min-h-screen flex flex-col">
      {/* Полное имя ученика ("Иванова Мария Петровна") на узкой ширине рядом
          с логотипом и навигацией не помещается — скрыто ниже sm, профиль
          и так открывается через иконку настроек. */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-14 items-center justify-between px-4 gap-2">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <Link href="/student" className="font-semibold text-sm shrink-0">
              ExamPlatform
            </Link>
            <StudentNav />
          </div>
          {/* Настройки — служебный пункт, не рабочий раздел: место у профиля,
              не в одном ряду с заданиями/досками */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <Link
              href="/student/settings"
              className="p-2 -m-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Настройки"
            >
              <Settings className="h-4 w-4" />
            </Link>
            <span className="text-sm text-muted-foreground hidden sm:inline truncate max-w-40">{profile.full_name}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-6">{children}</main>
    </div>
  )
}
