import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// PUT /api/roadmaps/reorder
// Body: { roadmap_ids: string[] } — новый порядок программ учителя внутри
// одного предмета (полный список id этой группы, не всех программ учителя).
// sort_order не уникален (в отличие от test_tasks.task_number) — можно
// проставлять в один проход, без промежуточного отрицательного диапазона.
export async function PUT(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const roadmapIds = body.roadmap_ids as unknown
  if (!Array.isArray(roadmapIds) || roadmapIds.length === 0 || roadmapIds.some(id => typeof id !== 'string')) {
    return Response.json({ error: 'roadmap_ids required' }, { status: 400 })
  }

  // Все переданные id должны быть программами этого учителя (RLS уже это
  // требует для UPDATE, здесь — чтобы явно отклонить чужой/неполный список
  // с понятной ошибкой вместо тихого "0 строк обновлено").
  const ids = roadmapIds as string[]
  const { data: existing } = await supabase
    .from('roadmaps')
    .select('id')
    .eq('created_by', user.id)
    .in('id', ids)
  const validIds = new Set((existing ?? []).map(r => r.id))
  if (ids.length !== validIds.size || !ids.every(id => validIds.has(id))) {
    return Response.json({ error: 'Список программ не совпадает с вашими' }, { status: 400 })
  }

  const results = await Promise.all(ids.map((id, i) =>
    supabase.from('roadmaps').update({ sort_order: i + 1 }).eq('id', id)
  ))
  const err = results.find(r => r.error)?.error
  if (err) return Response.json({ error: err.message }, { status: 500 })

  return Response.json({ ok: true })
}
