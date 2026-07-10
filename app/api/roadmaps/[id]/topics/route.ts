import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeRoadmap } from '@/lib/roadmaps/authorize'

const schema = z.object({
  title: z.string().trim().min(1, 'Введите название темы'),
  description: z.string().trim().optional().nullable(),
})

// POST /api/roadmaps/[id]/topics — добавить тему в конец списка
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authorizeRoadmap(id)
  if ('error' in auth) return auth.error
  const { admin } = auth

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const { data: last } = await admin
    .from('roadmap_topics').select('sort_order')
    .eq('roadmap_id', id).order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const nextOrder = (last?.sort_order ?? -1) + 1

  const { data: topic, error } = await admin.from('roadmap_topics').insert({
    roadmap_id: id,
    title: parsed.data.title,
    description: parsed.data.description || null,
    sort_order: nextOrder,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: topic.id }, { status: 201 })
}
