import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export type RoadmapAuth =
  | { admin: AdminClient; userId: string; orgId: string; groupId: string | null }
  | { error: Response }

// Управление road map: только учитель-владелец (created_by). Админ road map не
// редактирует (у него read-only «кабинет»). Возвращает admin-клиент для записи
// и id системной группы road map.
export async function authorizeRoadmap(
  roadmapId: string,
  message = 'Нет доступа к этой программе'
): Promise<RoadmapAuth> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || profile.role !== 'teacher' || !profile.organization_id) {
    return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const admin = createAdminClient()
  const { data: rm } = await admin
    .from('roadmaps').select('id, created_by, organization_id, group_id').eq('id', roadmapId).single()
  if (!rm) return { error: Response.json({ error: 'Программа не найдена' }, { status: 404 }) }
  if (rm.created_by !== user.id) {
    return { error: Response.json({ error: message }, { status: 403 }) }
  }

  return { admin, userId: user.id, orgId: profile.organization_id, groupId: rm.group_id }
}
