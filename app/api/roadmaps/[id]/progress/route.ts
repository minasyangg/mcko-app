import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRoadmapDetail } from '@/lib/roadmaps/progress'

// GET /api/roadmaps/[id]/progress — полная детализация программы для
// мониторинга (темы → задания → статус/балл по каждому ученику).
// Read-авторизация ОТДЕЛЬНА от authorizeRoadmap (та — write-only для
// учителя-владельца): читать прогресс может владелец-учитель ИЛИ admin
// той же организации (read-only, как кабинет учителя для админа).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: roadmap } = await admin
    .from('roadmaps').select('id, created_by, organization_id').eq('id', id).single()
  if (!roadmap) return Response.json({ error: 'Программа не найдена' }, { status: 404 })

  const isOwnerTeacher = profile.role === 'teacher' && roadmap.created_by === user.id
  const isOrgAdmin = profile.role === 'admin' && roadmap.organization_id === profile.organization_id
  if (!isOwnerTeacher && !isOrgAdmin) {
    return Response.json({ error: 'Нет доступа к этой программе' }, { status: 403 })
  }

  const detail = await getRoadmapDetail(admin, id)
  if (!detail) return Response.json({ error: 'Программа не найдена' }, { status: 404 })
  return Response.json(detail)
}
