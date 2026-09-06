import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Счётчик заявок на модерации — для бейджа на пункте «Пользователи».
// Возвращает ровно то число, что показывает таб «На модерации».
//
// Считаем admin-клиентом: у заявки с публичной регистрации organization_id
// ещё пуст, а политика «profiles: admin read org» требует совпадения
// организации — под обычным клиентом такие строки не видны вообще
// (тот же случай, что чинили в app/teacher/users/page.tsx).
export async function GET() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ count: 0 }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  // Заявки рассматривает только админ — учителю бейдж не нужен
  if (!profile || profile.role !== 'admin') {
    return Response.json({ count: 0 }, { status: 403 })
  }

  const { count } = await createAdminClient()
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('moderation_status', 'pending')
    .is('deleted_at', null)

  return Response.json({ count: count ?? 0 })
}
