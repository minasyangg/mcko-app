import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/components/shared/LogoutButton'
import { Settings } from 'lucide-react'

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
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
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link href="/student" className="font-semibold text-sm">
              ExamPlatform
            </Link>
            {/* «Мои тесты» и «Программа» объединены в табы на главной странице
                (/student) — назначение может прийти как обычный тест/ДЗ, так и
                через программу, и ученик должен видеть всё назначенное в одном
                месте, а не искать по разным разделам. «Мои доски» — отдельная
                функция, не назначение, остаётся самостоятельным пунктом. */}
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/student" className="px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                Мои задания
              </Link>
              <Link href="/student/boards" className="px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                Мои доски
              </Link>
            </nav>
          </div>
          {/* Настройки — служебный пункт, не рабочий раздел: место у профиля,
              не в одном ряду с заданиями/досками */}
          <div className="flex items-center gap-3">
            <Link
              href="/student/settings"
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Настройки"
            >
              <Settings className="h-4 w-4" />
            </Link>
            <span className="text-sm text-muted-foreground">{profile.full_name}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-6">{children}</main>
    </div>
  )
}
