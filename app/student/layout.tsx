import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { LogoutButton } from '@/components/shared/LogoutButton'

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
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/student" className="px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                Мои тесты
              </Link>
              <Link href="/student/boards" className="px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                Мои доски
              </Link>
              <Link href="/student/roadmap" className="px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                Программа
              </Link>
              <Link href="/student/settings" className="px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                Настройки
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{profile.full_name}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-6">{children}</main>
    </div>
  )
}
