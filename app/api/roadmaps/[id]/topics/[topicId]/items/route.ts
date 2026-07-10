import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'
import { authorizeRoadmap } from '@/lib/roadmaps/authorize'
import { deleteAssignmentsDeep } from '@/lib/assignments/cleanup'

const schema = z.object({
  test_id: zUuid(),
  kind: z.enum(['homework', 'test']).default('homework'),
  starts_at: z.string().optional().nullable(),
  ends_at: z.string().optional().nullable(),
  max_attempts: z.number().int().min(1).default(1),
})

type Params = { params: Promise<{ id: string; topicId: string }> }

// POST — привязать тест к теме: создаётся групповое назначение на системную
// группу программы с roadmap_topic_id и меткой kind (ДЗ/тест).
export async function POST(request: NextRequest, { params }: Params) {
  const { id, topicId } = await params
  const auth = await authorizeRoadmap(id)
  if ('error' in auth) return auth.error
  const { admin, userId, orgId, groupId } = auth
  if (!groupId) return NextResponse.json({ error: 'У программы нет группы' }, { status: 400 })

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const { test_id, kind, starts_at, ends_at, max_attempts } = parsed.data

  // Тема принадлежит программе
  const { data: topic } = await admin
    .from('roadmap_topics').select('id').eq('id', topicId).eq('roadmap_id', id).single()
  if (!topic) return NextResponse.json({ error: 'Тема не найдена' }, { status: 404 })

  // Тест — свой, опубликованный, из своей организации
  const { data: test } = await admin
    .from('tests').select('current_published_version_id, organization_id, created_by')
    .eq('id', test_id).single()
  if (!test || test.organization_id !== orgId) {
    return NextResponse.json({ error: 'Тест не найден' }, { status: 404 })
  }
  if (test.created_by !== userId) {
    return NextResponse.json({ error: 'Привязать можно только свой тест' }, { status: 403 })
  }
  if (!test.current_published_version_id) {
    return NextResponse.json({ error: 'Тест не опубликован' }, { status: 400 })
  }

  const { data: assignment, error } = await admin.from('assignments').insert({
    test_version_id: test.current_published_version_id,
    organization_id: orgId,
    group_id: groupId,
    student_id: null,
    roadmap_topic_id: topicId,
    kind,
    starts_at: starts_at || null,
    ends_at: ends_at || null,
    max_attempts,
    created_by: userId,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: assignment.id }, { status: 201 })
}

// DELETE ?assignment_id=... — отвязать тест от темы (удаляет назначение и его
// попытки).
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id, topicId } = await params
  const auth = await authorizeRoadmap(id)
  if ('error' in auth) return auth.error
  const { admin } = auth

  const assignmentId = new URL(request.url).searchParams.get('assignment_id')
  if (!assignmentId) return NextResponse.json({ error: 'assignment_id required' }, { status: 400 })

  // Назначение действительно относится к этой теме
  const { data: asgn } = await admin
    .from('assignments').select('id').eq('id', assignmentId).eq('roadmap_topic_id', topicId).single()
  if (!asgn) return NextResponse.json({ error: 'Назначение не найдено' }, { status: 404 })

  await deleteAssignmentsDeep(admin, [assignmentId])
  return NextResponse.json({ ok: true })
}
