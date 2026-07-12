import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export type AdminAuth =
  | { admin: AdminClient; userId: string; orgId: string }
  | { error: Response }

// Единая проверка «запрос от админа с организацией» для admin-роутов —
// раньше инлайн-копии verifyAdmin жили в каждом роуте. Возвращает admin-клиент
// для записи (service role) и организацию для скоупинга.
export async function requireAdmin(
  message = 'Доступно только администратору'
): Promise<AdminAuth> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin' || !profile.organization_id) {
    return { error: Response.json({ error: message }, { status: 403 }) }
  }

  return { admin: createAdminClient(), userId: user.id, orgId: profile.organization_id }
}
