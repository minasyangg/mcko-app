import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeRoadmap } from '@/lib/roadmaps/authorize'
import { deleteAssignmentsDeep } from '@/lib/assignments/cleanup'
import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

const patchSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().optional().nullable(),
  sort_order: z.number().int().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  visible_to_students: z.boolean().optional(),
})

type Params = { params: Promise<{ id: string; topicId: string }> }

// Тема + все вложенные (дерево roadmap_topics.parent_id) — тот же приём
// сбора поддерева BFS, что уже используется для book_sections
// (app/api/books/[id]/sections/[sectionId]/route.ts).
async function collectSubtreeIds(admin: AdminClient, roadmapId: string, rootId: string) {
  const { data: all } = await admin.from('roadmap_topics').select('id, parent_id').eq('roadmap_id', roadmapId)
  const childrenOf = new Map<string, string[]>()
  for (const t of all ?? []) {
    if (!t.parent_id) continue
    const arr = childrenOf.get(t.parent_id) ?? []
    arr.push(t.id)
    childrenOf.set(t.parent_id, arr)
  }
  const ids: string[] = []
  const queue = [rootId]
  while (queue.length) {
    const cur = queue.shift() as string
    ids.push(cur)
    for (const child of childrenOf.get(cur) ?? []) queue.push(child)
  }
  return ids
}

// PATCH — переименовать/переупорядочить/перенести тему (смена parent_id —
// перемещение внутри дерева, например поднять деталь на уровень подтемы).
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, topicId } = await params
  const auth = await authorizeRoadmap(id)
  if ('error' in auth) return auth.error
  const { admin } = auth

  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  // Тема не может стать сама себе предком (прямо или через своё поддерево) —
  // иначе parent_id зацикливается и дерево ломается при обходе. Отдельно —
  // parent_id обязан принадлежать ТОЙ ЖЕ программе: без этой проверки можно
  // было сослаться на тему из чужого roadmap (id доступен, если известен, —
  // сама проверка через collectSubtreeIds ищет цикл только внутри текущей
  // программы и молча пропустила бы чужой id). Итог без проверки: учитель
  // видел бы узел в дереве RoadmapEditor (buildTopicTree трактует "predок не
  // найден в byId" как root, не как ошибку), а topicsInTreeOrder на стороне
  // ученика (app/student/page.tsx) не находит его в обходе от null и вся
  // подветка немо исчезает из "Программы" без объяснения.
  if (parsed.data.parent_id) {
    const { data: parent } = await admin
      .from('roadmap_topics').select('id').eq('id', parsed.data.parent_id).eq('roadmap_id', id).single()
    if (!parent) {
      return NextResponse.json({ error: 'Родительская тема не найдена в этой программе' }, { status: 400 })
    }
    const subtreeIds = new Set(await collectSubtreeIds(admin, id, topicId))
    if (subtreeIds.has(parsed.data.parent_id)) {
      return NextResponse.json({ error: 'Нельзя перенести тему внутрь самой себя или своего поддерева' }, { status: 400 })
    }
  }

  const patch: { title?: string; description?: string | null; sort_order?: number; parent_id?: string | null; visible_to_students?: boolean } = {}
  if (parsed.data.title !== undefined) patch.title = parsed.data.title
  if (parsed.data.description !== undefined) patch.description = parsed.data.description || null
  if (parsed.data.sort_order !== undefined) patch.sort_order = parsed.data.sort_order
  if (parsed.data.parent_id !== undefined) patch.parent_id = parsed.data.parent_id
  if (parsed.data.visible_to_students !== undefined) patch.visible_to_students = parsed.data.visible_to_students
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })

  const { error } = await admin.from('roadmap_topics').update(patch)
    .eq('id', topicId).eq('roadmap_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// GET — превью перед удалением: сколько тем в поддереве затронуто, сколько
// назначений, и главное — есть ли уже СДАННЫЕ попытки (submitted/checked).
// Если есть — украшать предупреждением недостаточно (в отличие от книжных
// разделов, см. app/api/books/[id]/sections/[sectionId]/route.ts): результаты
// учеников по сданным работам не должны исчезать при правке структуры темы,
// это отдельное явное правило проекта (project_homework_agent, 2026-09-18).
export async function GET(_request: NextRequest, { params }: Params) {
  const { id, topicId } = await params
  const auth = await authorizeRoadmap(id)
  if ('error' in auth) return auth.error
  const { admin } = auth

  const { data: topic } = await admin
    .from('roadmap_topics').select('id, title').eq('id', topicId).eq('roadmap_id', id).single()
  if (!topic) return NextResponse.json({ error: 'Тема не найдена' }, { status: 404 })

  const subtreeIds = await collectSubtreeIds(admin, id, topicId)
  const { data: assignments } = await admin
    .from('assignments').select('id').in('roadmap_topic_id', subtreeIds)
  const assignmentIds = (assignments ?? []).map(a => a.id)

  let submittedCount = 0
  if (assignmentIds.length > 0) {
    const { count } = await admin
      .from('attempts')
      .select('id', { count: 'exact', head: true })
      .in('assignment_id', assignmentIds)
      .in('status', ['submitted', 'checked'])
    submittedCount = count ?? 0
  }

  return NextResponse.json({
    title: topic.title,
    topics_count: subtreeIds.length,
    assignments_count: assignmentIds.length,
    submitted_attempts_count: submittedCount,
    blocked: submittedCount > 0,
  })
}

// DELETE — удалить тему и всё её поддерево. Отказывает (409), если у
// поддерева есть хоть одна сданная попытка (submitted/checked) — это жёстче,
// чем книжный паттерн (там разрешает с предупреждением, потому что там
// «страдает» самое большее ссылка test_tasks.book_problem_id → null, а не
// чужой результат работы). Без сданных попыток — ведёт себя как раньше:
// глубоко чистит назначения (deleteAssignmentsDeep), затем удаляет темы
// (on delete cascade по parent_id подчищает поддерево одним DELETE корня).
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id, topicId } = await params
  const auth = await authorizeRoadmap(id)
  if ('error' in auth) return auth.error
  const { admin } = auth

  const subtreeIds = await collectSubtreeIds(admin, id, topicId)
  const { data: assignments } = await admin
    .from('assignments').select('id').in('roadmap_topic_id', subtreeIds)
  const assignmentIds = (assignments ?? []).map(a => a.id)

  if (assignmentIds.length > 0) {
    const { count: submittedCount } = await admin
      .from('attempts')
      .select('id', { count: 'exact', head: true })
      .in('assignment_id', assignmentIds)
      .in('status', ['submitted', 'checked'])
    if ((submittedCount ?? 0) > 0) {
      return NextResponse.json(
        { error: `У темы или её подтем есть ${submittedCount} сданных работ — удаление запрещено, чтобы не потерять результаты учеников. Отвяжите завершённые задания вручную, если это осознанное решение.` },
        { status: 409 }
      )
    }
  }

  await deleteAssignmentsDeep(admin, assignmentIds)

  const { error } = await admin.from('roadmap_topics').delete()
    .eq('id', topicId).eq('roadmap_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, deleted_topics: subtreeIds.length })
}
