import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeRoadmap } from '@/lib/roadmaps/authorize'
import { deleteAssignmentsDeep } from '@/lib/assignments/cleanup'

const patchSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().optional().nullable(),
  sort_order: z.number().int().optional(),
})

type Params = { params: Promise<{ id: string; topicId: string }> }

// PATCH — переименовать/переупорядочить тему
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, topicId } = await params
  const auth = await authorizeRoadmap(id)
  if ('error' in auth) return auth.error
  const { admin } = auth

  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const patch: { title?: string; description?: string | null; sort_order?: number } = {}
  if (parsed.data.title !== undefined) patch.title = parsed.data.title
  if (parsed.data.description !== undefined) patch.description = parsed.data.description || null
  if (parsed.data.sort_order !== undefined) patch.sort_order = parsed.data.sort_order
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })

  const { error } = await admin.from('roadmap_topics').update(patch)
    .eq('id', topicId).eq('roadmap_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE — удалить тему. Сначала глубоко удаляем её назначения (+попытки),
// иначе каскад roadmap_topic_id упрётся в RESTRICT на attempts.
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id, topicId } = await params
  const auth = await authorizeRoadmap(id)
  if ('error' in auth) return auth.error
  const { admin } = auth

  const { data: asgns } = await admin
    .from('assignments').select('id').eq('roadmap_topic_id', topicId)
  await deleteAssignmentsDeep(admin, (asgns ?? []).map(a => a.id))

  const { error } = await admin.from('roadmap_topics').delete()
    .eq('id', topicId).eq('roadmap_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
