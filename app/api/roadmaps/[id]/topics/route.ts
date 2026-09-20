import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeRoadmap } from '@/lib/roadmaps/authorize'

const schema = z.object({
  title: z.string().trim().min(1, 'Введите название темы'),
  description: z.string().trim().optional().nullable(),
  // Родительская тема — для добавления подтемы/детали внутрь дерева.
  // Отсутствует/null — новая тема верхнего уровня (как раньше).
  parent_id: z.string().uuid().optional().nullable(),
})

// POST /api/roadmaps/[id]/topics — добавить тему в конец списка ЕЁ уровня
// (среди тем с тем же parent_id, не глобально — иначе новая деталь внутри
// подтемы получала бы sort_order, посчитанный по темам верхнего уровня).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authorizeRoadmap(id)
  if ('error' in auth) return auth.error
  const { admin } = auth

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const parentId = parsed.data.parent_id ?? null

  if (parentId) {
    const { data: parent } = await admin
      .from('roadmap_topics').select('id').eq('id', parentId).eq('roadmap_id', id).single()
    if (!parent) return NextResponse.json({ error: 'Родительская тема не найдена' }, { status: 404 })
  }

  let siblingsQuery = admin
    .from('roadmap_topics').select('sort_order')
    .eq('roadmap_id', id).order('sort_order', { ascending: false }).limit(1)
  siblingsQuery = parentId ? siblingsQuery.eq('parent_id', parentId) : siblingsQuery.is('parent_id', null)
  const { data: last } = await siblingsQuery.maybeSingle()
  const nextOrder = (last?.sort_order ?? -1) + 1

  const { data: topic, error } = await admin.from('roadmap_topics').insert({
    roadmap_id: id,
    parent_id: parentId,
    title: parsed.data.title,
    description: parsed.data.description || null,
    sort_order: nextOrder,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: topic.id }, { status: 201 })
}
