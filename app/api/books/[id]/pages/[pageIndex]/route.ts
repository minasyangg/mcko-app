import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeAnchors } from '@/lib/books/anchors'
import { NextRequest } from 'next/server'

// PATCH /api/books/[id]/pages/[pageIndex]
// Body: { markdown: string }
// Правка текста страницы (теории). Только владелец книги или admin.
// Якоря заданий страницы пересчитываются, их prompt_md обновляется.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pageIndex: string }> }
) {
  const { id: bookId, pageIndex: pageIndexRaw } = await params
  const pageIndex = parseInt(pageIndexRaw)
  if (isNaN(pageIndex)) return Response.json({ error: 'Invalid page index' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: book } = await admin
    .from('books')
    .select('id, created_by')
    .eq('id', bookId)
    .single()
  if (!book) return Response.json({ error: 'Book not found' }, { status: 404 })

  if (profile.role !== 'admin' && book.created_by !== user.id) {
    return Response.json({ error: 'Редактировать может только владелец книги или администратор' }, { status: 403 })
  }

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
    .select('id, task_number, md_start, md_end, prompt_md')
    .eq('book_id', bookId)
    .eq('page_index', pageIndex)

  const anchors = computeAnchors(newMd, (pageProblems ?? []).map(p => p.task_number))
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
