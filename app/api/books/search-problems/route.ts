import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

// GET /api/books/search-problems?q=<номер или текст> — общий поиск заданий
// по ВСЕМ книгам (в отличие от /api/books/[id]/search). Чтение через RLS.
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const q = new URL(request.url).searchParams.get('q')?.trim()
  if (!q || q.length < 2) return Response.json({ results: [] })

  let query = supabase
    .from('book_problems')
    .select('id, book_id, task_number, section_id, page_index, prompt_md, books!inner(title, subject, grade)')
    .eq('is_active', true)
    .limit(30)

  if (/^\d{1,4}(\.\d{1,3})?$/.test(q)) {
    // точный номер задания: «735» или «5.30»
    query = query.eq('task_number', q)
  } else {
    // websearch-режим переживает произвольный пользовательский ввод
    query = query.textSearch('prompt_md', q, { config: 'russian', type: 'websearch' })
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const results = (data ?? []).map(p => {
    const b = p.books as unknown as { title: string; subject: string; grade: string | null }
    return {
      id: p.id,
      book_id: p.book_id,
      book_title: b?.title ?? '—',
      book_subject: b?.subject ?? null,
      book_grade: b?.grade ?? null,
      task_number: p.task_number,
      section_id: p.section_id,
      snippet: p.prompt_md.replace(/\s+/g, ' ').slice(0, 160),
    }
  })

  return Response.json({ results })
}
