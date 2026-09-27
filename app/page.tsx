import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'

export default async function RootPage() {
  const supabase = await createClient()
  const { data: { user } } = await getAuthUser(supabase)

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/no-profile')
  if (profile.role === 'student') redirect('/student')
  redirect('/teacher')
}
