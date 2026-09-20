import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeRoadmap } from '@/lib/roadmaps/authorize'

// PUT /api/roadmaps/[id]/topics/reorder — один вызов на одно перетаскивание
// в дереве тем: либо перестановка среди тем с тем же родителем, либо перенос
// узла под другого родителя (drag-and-drop в RoadmapEditor, HTML5 DnD,
// десктоп-only — см. TopicTreeItem). Тело — полный новый список siblings
// уровня, куда попал перетаскиваемый узел (тот же приём, что
// /api/roadmaps/reorder, только с parent_id, т.к. уровней несколько).
const schema = z.object({
  // parent_id самого перетаскиваемого узла после переноса (null — корень)
  moved_id: z.string().uuid(),
  new_parent_id: z.string().uuid().nullable(),
  // Полный порядок id внутри целевого уровня (siblings нового родителя),
  // включая moved_id — сервер проставляет sort_order по позиции в массиве.
  ordered_ids: z.array(z.string().uuid()).min(1),
})

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authorizeRoadmap(id)
  if ('error' in auth) return auth.error
  const { admin } = auth

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { moved_id: movedId, new_parent_id: newParentId, ordered_ids: orderedIds } = parsed.data

  if (!orderedIds.includes(movedId)) {
    return NextResponse.json({ error: 'ordered_ids должен включать moved_id' }, { status: 400 })
  }

  const { data: all } = await admin.from('roadmap_topics').select('id, parent_id').eq('roadmap_id', id)
  const byId = new Map((all ?? []).map(t => [t.id, t]))
  if (!byId.has(movedId)) return NextResponse.json({ error: 'Тема не найдена' }, { status: 404 })
  if (newParentId && !byId.has(newParentId)) {
    return NextResponse.json({ error: 'Родительская тема не найдена' }, { status: 404 })
  }

  // Тема не может стать сама себе предком через своё же поддерево — тот же
  // BFS-приём, что и в PATCH одиночной темы.
  if (newParentId) {
    const childrenOf = new Map<string, string[]>()
    for (const t of all ?? []) {
      if (!t.parent_id) continue
      const arr = childrenOf.get(t.parent_id) ?? []
      arr.push(t.id)
      childrenOf.set(t.parent_id, arr)
    }
    const subtree = new Set<string>()
    const queue = [movedId]
    while (queue.length) {
      const cur = queue.shift() as string
      subtree.add(cur)
      for (const child of childrenOf.get(cur) ?? []) queue.push(child)
    }
    if (subtree.has(newParentId)) {
      return NextResponse.json({ error: 'Нельзя перенести тему внутрь самой себя или своего поддерева' }, { status: 400 })
    }
  }

  // Остальные id в ordered_ids должны реально быть siblings нового родителя —
  // иначе один запрос мог бы тихо переставить порядок в чужой ветке дерева.
  const actualSiblingIds = new Set(
    (all ?? []).filter(t => t.id !== movedId && (t.parent_id ?? null) === newParentId).map(t => t.id)
  )
  for (const oid of orderedIds) {
    if (oid !== movedId && !actualSiblingIds.has(oid)) {
      return NextResponse.json({ error: 'ordered_ids не совпадает с темами целевого уровня' }, { status: 400 })
    }
  }

  const results = await Promise.all(orderedIds.map((topicId, i) => {
    const patch: { sort_order: number; parent_id?: string | null } = { sort_order: i }
    if (topicId === movedId) patch.parent_id = newParentId
    return admin.from('roadmap_topics').update(patch).eq('id', topicId).eq('roadmap_id', id)
  }))
  const err = results.find(r => r.error)?.error
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
