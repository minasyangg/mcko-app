import { NextRequest, NextResponse } from 'next/server'
import { zUuid } from '@/lib/uuid'
import { authorizeRoadmap } from '@/lib/roadmaps/authorize'

// POST /api/roadmaps/[id]/source-groups — зарегистрировать группу как «живой
// источник» участников программы: с этого момента добавление ученика в эту
// группу (group_members insert) автоматически добавляет его и в системную
// группу программы — см. триггер group_members_sync_roadmaps (миграция 059).
// Раньше «Добавить группу» в редакторе лишь копировала список участников
// один раз на момент клика, и новый ученик группы в программу не попадал.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authorizeRoadmap(id)
  if ('error' in auth) return auth.error
  const { admin, groupId } = auth
  if (!groupId) return NextResponse.json({ error: 'У программы нет группы' }, { status: 400 })

  const body = await request.json().catch(() => null) as { group_id?: string } | null
  const parsedGroupId = zUuid().safeParse(body?.group_id)
  if (!parsedGroupId.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const sourceGroupId = parsedGroupId.data

  if (sourceGroupId === groupId) {
    return NextResponse.json({ error: 'Нельзя использовать саму программу как источник' }, { status: 400 })
  }

  // Группа должна принадлежать тому же учителю — иначе можно было бы
  // подписаться на чужую группу и получать её будущих участников.
  const { data: srcGroup } = await admin
    .from('groups').select('id, created_by').eq('id', sourceGroupId).single()
  if (!srcGroup || srcGroup.created_by !== auth.userId) {
    return NextResponse.json({ error: 'Группа не найдена' }, { status: 404 })
  }

  await admin.from('roadmap_source_groups').upsert(
    { roadmap_id: id, group_id: sourceGroupId },
    { onConflict: 'roadmap_id,group_id' }
  )

  // Мгновенный синк уже существующих участников группы — не ждать, пока
  // придёт следующий INSERT, чтобы вставшая только что связь применилась
  // сразу ко всем, кто уже состоит в группе.
  const { data: members } = await admin
    .from('group_members').select('user_id').eq('group_id', sourceGroupId)
  for (const m of members ?? []) {
    await admin.rpc('sync_student_to_roadmaps_from_group', { p_group_id: sourceGroupId, p_user_id: m.user_id })
  }

  return NextResponse.json({ ok: true })
}

// DELETE /api/roadmaps/[id]/source-groups?group_id=... — отвязать источник.
// Участников, уже попавших в программу через эту связь, НЕ удаляет — только
// останавливает будущий автоматический приток (симметрично тому, что «Изменить
// баллы» не трогает уже выставленные баллы).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authorizeRoadmap(id)
  if ('error' in auth) return auth.error
  const { admin } = auth

  const sourceGroupId = request.nextUrl.searchParams.get('group_id')
  const parsed = zUuid().safeParse(sourceGroupId)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid group_id' }, { status: 400 })

  await admin.from('roadmap_source_groups')
    .delete().eq('roadmap_id', id).eq('group_id', parsed.data)

  return NextResponse.json({ ok: true })
}
