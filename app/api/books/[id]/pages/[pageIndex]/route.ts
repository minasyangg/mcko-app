import { authorizeBookEdit } from '@/lib/books/authorize'
import { computeAnchors } from '@/lib/books/anchors'
import { NextRequest } from 'next/server'

// PATCH /api/books/[id]/pages/[pageIndex]
// Body: { markdown: string }
// Правка текста страницы (теории). Владелец книги, учитель с грантом или admin.
// Якоря заданий страницы пересчитываются, их prompt_md обновляется.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pageIndex: string }> }
) {
  const { id: bookId, pageIndex: pageIndexRaw } = await params
  const pageIndex = parseInt(pageIndexRaw)
  if (isNaN(pageIndex)) return Response.json({ error: 'Invalid page index' }, { status: 400 })

  const auth = await authorizeBookEdit(bookId)
  if (auth.error) return auth.error
  const admin = auth.admin

  const body = await request.json() as { markdown?: string }
  if (typeof body.markdown !== 'string' || body.markdown.trim() === '') {
    return Response.json({ error: 'markdown required' }, { status: 400 })
  }
  if (body.markdown.length > 100_000) {
    return Response.json({ error: 'Слишком длинный текст страницы' }, { status: 400 })
  }
  const newMd = body.markdown

  const { data: page } = await admin
    .from('book_pages')
    .select('id, markdown')
    .eq('book_id', bookId)
    .eq('page_index', pageIndex)
    .single()
  if (!page) return Response.json({ error: 'Page not found' }, { status: 404 })

  const { error: pageErr } = await admin
    .from('book_pages')
    .update({ markdown: newMd })
    .eq('id', page.id)
  if (pageErr) return Response.json({ error: pageErr.message }, { status: 500 })

  // Пересчёт якорей и prompt_md заданий этой страницы
  const { data: pageProblems } = await admin
    .from('book_problems')
    .select('id, task_number, task_number_sort, md_start, md_end, prompt_md')
    .eq('book_id', bookId)
    .eq('page_index', pageIndex)

  const anchors = computeAnchors(newMd, (pageProblems ?? []).map(p => p.task_number),
          new Map((pageProblems ?? []).map(p => [p.task_number, p.task_number_sort ?? 0])))
  let lost = 0
  for (const p of pageProblems ?? []) {
    const a = anchors.get(p.task_number)
    if (!a) {
      // номер исчез из текста — задание остаётся в базе, но без рамки в читалке
      lost++
      await admin.from('book_problems').update({ md_start: null, md_end: null }).eq('id', p.id)
      continue
    }
    // сохранить хвост-продолжение со следующей страницы, если был
    const oldInPageLen = p.md_start !== null && p.md_end !== null ? p.md_end - p.md_start : null
    const suffix = oldInPageLen !== null && p.prompt_md.length > oldInPageLen + 2
      ? p.prompt_md.slice(oldInPageLen)
      : ''
    await admin.from('book_problems').update({
      md_start: a.start,
      md_end: a.end,
      prompt_md: (newMd.slice(a.start, a.end).trim() + suffix).trim(),
      updated_at: new Date().toISOString(),
    }).eq('id', p.id)
  }

  return Response.json({ ok: true, problems_updated: (pageProblems ?? []).length - lost, anchors_lost: lost })
}

// DELETE /api/books/[id]/pages/[pageIndex]
// Полное удаление страницы и всех заданий на ней. Только владелец книги
// или admin. page_index соседних страниц НЕ сдвигается (нумерация страниц
// и task_number остальных заданий не меняются — связи test_tasks на другие
// задания и границы разделов остаются валидны); в тестах, куда задания уже
// добавлены, их копии сохраняются (test_tasks.book_problem_id → set null).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pageIndex: string }> }
) {
  const { id: bookId, pageIndex: pageIndexRaw } = await params
  const pageIndex = parseInt(pageIndexRaw)
  if (isNaN(pageIndex)) return Response.json({ error: 'Invalid page index' }, { status: 400 })

  const auth = await authorizeBookEdit(bookId)
  if (auth.error) return auth.error
  const admin = auth.admin

  const { data: page } = await admin
    .from('book_pages')
    .select('id')
    .eq('book_id', bookId)
    .eq('page_index', pageIndex)
    .single()
  if (!page) return Response.json({ error: 'Page not found' }, { status: 404 })

  const { error: probErr } = await admin
    .from('book_problems')
    .delete()
    .eq('book_id', bookId)
    .eq('page_index', pageIndex)
  if (probErr) return Response.json({ error: probErr.message }, { status: 500 })

  const { error: pageErr } = await admin
    .from('book_pages')
    .delete()
    .eq('id', page.id)
  if (pageErr) return Response.json({ error: pageErr.message }, { status: 500 })

  return Response.json({ ok: true })
}
