import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeRoadmap } from '@/lib/roadmaps/authorize'

const schema = z.object({ topic_id: z.string().uuid() })

// PATCH — перенести уже назначенное ДЗ/тест в другую тему той же программы
// (drag-and-drop карточки в RoadmapEditor). Только UI/UX-перепривязка: меняет
// исключительно assignments.roadmap_topic_id, не трогает саму запись
// назначения и тем более attempts — результаты уже сданных работ ссылаются
// на assignment_id, а не на тему, поэтому физически не могут пострадать.
// Не переиспользует DELETE из topics/[topicId]/items — тот вызывает
// deleteAssignmentsDeep и уничтожил бы попытки учеников.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; assignmentId: string }> }) {
  const { id, assignmentId } = await params
  const auth = await authorizeRoadmap(id)
  if ('error' in auth) return auth.error
  const { admin, groupId } = auth
  if (!groupId) return NextResponse.json({ error: 'У программы нет группы' }, { status: 400 })

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { topic_id: topicId } = parsed.data

  const { data: assignment } = await admin
    .from('assignments').select('id').eq('id', assignmentId).eq('group_id', groupId).single()
  if (!assignment) return NextResponse.json({ error: 'Назначение не найдено' }, { status: 404 })

  const { data: topic } = await admin
    .from('roadmap_topics').select('id').eq('id', topicId).eq('roadmap_id', id).single()
  if (!topic) return NextResponse.json({ error: 'Тема не найдена' }, { status: 404 })

  const { error } = await admin.from('assignments').update({ roadmap_topic_id: topicId }).eq('id', assignmentId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
