import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeBookEdit } from '@/lib/books/authorize'
import { computeAnchors } from '@/lib/books/anchors'
import { NextRequest } from 'next/server'

type AdminClient = ReturnType<typeof createAdminClient>

const authorize = (bookId: string) =>
  authorizeBookEdit(bookId, 'Доступно только владельцу книги, учителю с доступом или администратору')

// Раздел + все вложенные (дерево book_sections.parent_id)
async function collectSubtreeIds(admin: AdminClient, bookId: string, rootId: string) {
  const { data: all } = await admin.from('book_sections').select('id, parent_id').eq('book_id', bookId)
  const childrenOf = new Map<string, string[]>()
  for (const s of all ?? []) {
    if (!s.parent_id) continue
    const arr = childrenOf.get(s.parent_id) ?? []
    arr.push(s.id)
    childrenOf.set(s.parent_id, arr)
  }
  const ids: string[] = []
  const queue = [rootId]
  while (queue.length) {
    const cur = queue.shift()!
    ids.push(cur)
    for (const child of childrenOf.get(cur) ?? []) queue.push(child)
  }
  return ids
}

// Тесты, в которые уже добавлены задания раздела (для предупреждения перед удалением)
async function testUsageFor(admin: AdminClient, problemIds: string[]) {
  if (problemIds.length === 0) return []
  const { data: taskRows } = await admin
    .from('test_tasks')
    .select('test_version_id')
    .in('book_problem_id', problemIds)
  const versionIds = [...new Set((taskRows ?? []).map(t => t.test_version_id).filter((v): v is string => v !== null))]
  if (versionIds.length === 0) return []

  const { data: versions } = await admin
    .from('test_versions').select('id, test_id').in('id', versionIds)
  const testIds = [...new Set((versions ?? []).map(v => v.test_id).filter((v): v is string => v !== null))]
  const { data: tests } = await admin.from('tests').select('id, title').in('id', testIds)

  const countByTest = new Map<string, number>()
  const versionToTest = new Map((versions ?? []).map(v => [v.id, v.test_id]))
  for (const t of taskRows ?? []) {
    const testId = t.test_version_id ? versionToTest.get(t.test_version_id) : null
    if (!testId) continue
    countByTest.set(testId, (countByTest.get(testId) ?? 0) + 1)
  }
  return (tests ?? []).map(t => ({
    test_id: t.id,
    title: t.title,
    count: countByTest.get(t.id) ?? 0,
  }))
}

// GET /api/books/[id]/sections/[sectionId]
// Превью перед удалением: сколько заданий и разделов затронуто, в каких
// тестах уже используются задания — чтобы предупредить пользователя.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  const { id: bookId, sectionId } = await params
  const auth = await authorize(bookId)
  if (auth.error) return auth.error
  const admin = auth.admin!

  const { data: section } = await admin
    .from('book_sections').select('id, title').eq('book_id', bookId).eq('id', sectionId).single()
  if (!section) return Response.json({ error: 'Section not found' }, { status: 404 })

  const subtreeIds = await collectSubtreeIds(admin, bookId, sectionId)
  const { data: problems } = await admin
    .from('book_problems').select('id').eq('book_id', bookId).in('section_id', subtreeIds)
  const problemIds = (problems ?? []).map(p => p.id)
  const testUsage = await testUsageFor(admin, problemIds)

  return Response.json({
    title: section.title,
    sections_count: subtreeIds.length,
    problems_count: problemIds.length,
    test_usage: testUsage,
  })
}

// PATCH /api/books/[id]/sections/[sectionId]
// Body: { title }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  const { id: bookId, sectionId } = await params
  const auth = await authorize(bookId)
  if (auth.error) return auth.error
  const admin = auth.admin!

  const body = await request.json() as { title?: string }
  const title = (body.title ?? '').trim()
  if (!title) return Response.json({ error: 'Название не может быть пустым' }, { status: 400 })
  if (title.length > 300) return Response.json({ error: 'Слишком длинное название' }, { status: 400 })

  const { error } = await admin
    .from('book_sections').update({ title }).eq('book_id', bookId).eq('id', sectionId)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}

// DELETE /api/books/[id]/sections/[sectionId]
// Удаляет раздел, все вложенные разделы (каскад по parent_id) и все задания,
// относящиеся к ним: текст вырезается из страниц, якоря соседних заданий
// пересчитываются. Копии заданий, уже добавленных в тесты, сохраняются
// (test_tasks.book_problem_id → set null) — но пользователь предупреждён
// заранее через GET-превью.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  const { id: bookId, sectionId } = await params
  const auth = await authorize(bookId)
  if (auth.error) return auth.error
  const admin = auth.admin!

  const { data: section } = await admin
    .from('book_sections').select('id').eq('book_id', bookId).eq('id', sectionId).single()
  if (!section) return Response.json({ error: 'Section not found' }, { status: 404 })

  const subtreeIds = await collectSubtreeIds(admin, bookId, sectionId)
  const { data: problems } = await admin
    .from('book_problems')
    .select('id, page_index, md_start, md_end')
    .eq('book_id', bookId)
    .in('section_id', subtreeIds)
  const targetIds = new Set((problems ?? []).map(p => p.id))
  const testUsage = await testUsageFor(admin, [...targetIds])

  // Вырезаем текст удаляемых заданий из страниц и пересчитываем якоря оставшихся
  const byPage = new Map<number, typeof problems>()
  for (const p of problems ?? []) {
    if (p.md_start === null || p.md_end === null) continue
    const arr = byPage.get(p.page_index) ?? []
    arr.push(p)
    byPage.set(p.page_index, arr)
  }

  for (const [pageIndex, probs] of byPage) {
    const { data: page } = await admin
      .from('book_pages').select('id, markdown').eq('book_id', bookId).eq('page_index', pageIndex).single()
    if (!page) continue

    let md = page.markdown
    for (const p of [...probs!].sort((a, b) => b.md_start! - a.md_start!)) {
      if (p.md_end! <= md.length) md = md.slice(0, p.md_start!) + md.slice(p.md_end!)
    }
    await admin.from('book_pages').update({ markdown: md }).eq('id', page.id)

    const { data: pageProblems } = await admin
      .from('book_problems')
      .select('id, task_number, task_number_sort')
      .eq('book_id', bookId)
      .eq('page_index', pageIndex)
    const remaining = (pageProblems ?? []).filter(p => !targetIds.has(p.id))
    const anchors = computeAnchors(md, remaining.map(p => p.task_number),
      new Map(remaining.map(p => [p.task_number, p.task_number_sort ?? 0])))
    for (const p of remaining) {
      const a = anchors.get(p.task_number) ?? null
      await admin.from('book_problems').update({
        md_start: a?.start ?? null,
        md_end: a?.end ?? null,
      }).eq('id', p.id)
    }
  }

  if (targetIds.size > 0) {
    const { error: probErr } = await admin.from('book_problems').delete().in('id', [...targetIds])
    if (probErr) return Response.json({ error: probErr.message }, { status: 500 })
  }

  // Каскад по parent_id (on delete cascade) удаляет все вложенные разделы
  const { error: secErr } = await admin.from('book_sections').delete().eq('id', sectionId)
  if (secErr) return Response.json({ error: secErr.message }, { status: 500 })

  return Response.json({
    ok: true,
    deleted_sections: subtreeIds.length,
    deleted_problems: targetIds.size,
    test_usage: testUsage,
  })
}
