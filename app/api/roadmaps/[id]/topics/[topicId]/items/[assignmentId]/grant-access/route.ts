import { NextRequest, NextResponse, after } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'
import { authorizeRoadmap } from '@/lib/roadmaps/authorize'
import { notifyAssignmentCreated } from '@/lib/notifications/send'

const schema = z.object({ student_id: zUuid() })

type Params = { params: Promise<{ id: string; topicId: string; assignmentId: string }> }

// POST — «Открыть доступ» ученику, которому групповое назначение темы не
// видно из-за правила «3 дня» (миграция 058, student_sees_group_assignment):
// он вступил в группу программы заметно позже, чем создано это задание, и
// RLS молча скрывает от него всю более раннюю историю группы.
//
// Точечное исключение, а не смена правила по умолчанию (по решению
// пользователя): вместо переписывания 3 RLS-функций на «видно всем всегда»
// (что вернуло бы старый инцидент — Абрамян Варвара увидела и сдала 9 чужих
// назначений сразу после добавления в группу) заводим ОБЫЧНОЕ персональное
// назначение (assignments.student_id) с тем же тестом — оно не проходит
// через group_id/student_sees_group_assignment вообще, значит видно ученику
// сразу, без изменения RLS. Без общего дедлайна группы и всегда 1 попытка
// (по решению пользователя — догнать, а не получить тот же лимит, что был бы
// без опоздания).
export async function POST(request: NextRequest, { params }: Params) {
  const { id, topicId, assignmentId } = await params
  const auth = await authorizeRoadmap(id)
  if ('error' in auth) return auth.error
  const { admin, userId, orgId, groupId } = auth
  if (!groupId) return NextResponse.json({ error: 'У программы нет группы' }, { status: 400 })

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const { student_id } = parsed.data

  // Исходное задание — групповое назначение этой самой темы программы
  const { data: source } = await admin
    .from('assignments')
    .select('id, group_id, test_version_id, kind, roadmap_topic_id, created_at')
    .eq('id', assignmentId)
    .eq('roadmap_topic_id', topicId)
    .single()
  if (!source || source.group_id !== groupId) {
    return NextResponse.json({ error: 'Назначение не найдено' }, { status: 404 })
  }

  // Ученик — текущий член группы программы (иначе «догонять» нечего — он
  // либо не в программе, либо это назначение ему и так видно)
  const { data: membership } = await admin
    .from('group_members')
    .select('added_at')
    .eq('group_id', groupId)
    .eq('user_id', student_id)
    .maybeSingle()
  if (!membership) {
    return NextResponse.json({ error: 'Ученик не состоит в группе программы' }, { status: 400 })
  }

  // Реальная проверка правила «3 дня» — та же формула, что в
  // student_sees_group_assignment (058). Не даём открыть доступ, если
  // назначение и так видно ученику: персональная копия тут бессмысленна и
  // задвоила бы попытки/прогресс по одному и тому же тесту.
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000
  const joinedAt = membership.added_at ? new Date(membership.added_at).getTime() : null
  const createdAt = source.created_at ? new Date(source.created_at).getTime() : null
  const isHidden = joinedAt !== null && createdAt !== null && joinedAt > createdAt + THREE_DAYS_MS
  if (!isHidden) {
    return NextResponse.json({ error: 'Это задание ученику уже видно, открывать доступ не нужно' }, { status: 400 })
  }

  // Уже открыто раньше тем же тестом этому ученику — не плодим дубли
  const { data: existing } = await admin
    .from('assignments')
    .select('id')
    .eq('student_id', student_id)
    .eq('test_version_id', source.test_version_id)
    .eq('roadmap_topic_id', topicId)
    .maybeSingle()
  if (existing) return NextResponse.json({ id: existing.id }, { status: 200 })

  const { data: assignment, error } = await admin.from('assignments').insert({
    test_version_id: source.test_version_id,
    organization_id: orgId,
    group_id: null,
    student_id,
    roadmap_topic_id: topicId,
    kind: source.kind,
    starts_at: null,
    ends_at: null,
    max_attempts: 1,
    created_by: userId,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  after(() => notifyAssignmentCreated(assignment.id))

  return NextResponse.json({ id: assignment.id }, { status: 201 })
}
