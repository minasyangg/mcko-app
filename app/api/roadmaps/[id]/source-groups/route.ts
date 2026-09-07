import { NextRequest, NextResponse } from 'next/server'
import { zUuid } from '@/lib/uuid'
import { authorizeRoadmap } from '@/lib/roadmaps/authorize'

// POST /api/roadmaps/[id]/source-groups — зарегистрировать группу как «живой
// источник» участников программы: с этого момента добавление ученика в эту
// группу (group_members insert) автоматически добавляет его и в системную
// группу программы — см. триггер group_members_sync_roadmaps (миграция 059)
// и его пару на teacher_students (060, на случай если ученик закрепляется за
// учителем позже, чем вступает в группу). Раньше «Добавить группу» в
// редакторе лишь копировала список участников один раз на момент клика, и
// новый ученик группы в программу не попадал.
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
  // подписаться на чужую группу и получать её будущих участников. Отдельно
  // запрещаем системную группу ЛЮБОЙ программы (roadmap_id not null): иначе
  // две программы одного учителя можно было бы зациклить друг на друге
  // (A источник для B, B источник для A) — единственный guard на стороне
  // БД защищает только от группы САМА-НА-СЕБЯ (см. миграцию 059).
  const { data: srcGroup, error: srcGroupErr } = await admin
    .from('groups').select('id, created_by, roadmap_id').eq('id', sourceGroupId).single()
  if (srcGroupErr || !srcGroup || srcGroup.created_by !== auth.userId) {
    return NextResponse.json({ error: 'Группа не найдена' }, { status: 404 })
  }
  if (srcGroup.roadmap_id != null) {
    return NextResponse.json({ error: 'Нельзя использовать системную группу программы как источник' }, { status: 400 })
  }

  const { error: upsertErr } = await admin.from('roadmap_source_groups').upsert(
    { roadmap_id: id, group_id: sourceGroupId },
    { onConflict: 'roadmap_id,group_id' }
  )
  if (upsertErr) return NextResponse.json({ error: 'Не удалось сохранить связь' }, { status: 500 })

  // Мгновенный синк уже существующих участников группы — не ждать, пока
  // придёт следующий INSERT, чтобы вставшая только что связь применилась
  // сразу ко всем, кто уже состоит в группе. Один SQL-вызов на всю группу
  // (sync_group_to_roadmaps, 060), а не цикл RPC на каждого участника —
  // цикл на большой группе рисковал таймаутом serverless-функции и нарушал
  // правило проекта не читать/не обрабатывать построчно без нужды.
  const { error: syncErr } = await admin.rpc('sync_group_to_roadmaps', { p_group_id: sourceGroupId })
  if (syncErr) {
    return NextResponse.json({
      ok: true,
      warning: 'Связь сохранена, но синхронизация текущих участников не удалась — они добавятся при следующем изменении состава группы',
    })
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
