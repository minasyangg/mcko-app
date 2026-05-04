import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { LogoutButton } from '@/components/shared/LogoutButton'
import { UserX } from 'lucide-react'

export default async function NoProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // If they now have a profile, send them to the right place
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()

  if (profile?.role === 'student') redirect('/student')
  if (profile?.role === 'teacher' || profile?.role === 'admin') redirect('/teacher')

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 text-center px-4">
      <UserX className="h-14 w-14 text-muted-foreground opacity-50" />
      <div className="space-y-2 max-w-sm">
        <h1 className="text-xl font-semibold">Аккаунт не настроен</h1>
        <p className="text-sm text-muted-foreground">
          Ваш аккаунт зарегистрирован, но учитель ещё не назначил вам роль.
          Обратитесь к учителю, чтобы он добавил вас в систему.
        </p>
        <p className="text-xs text-muted-foreground">Email: {user.email}</p>
      </div>
      <LogoutButton variant="outline" />
    </div>
  )
}
