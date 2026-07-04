import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

// GET /api/books/[id]/pages?from=<page_index>&to=<page_index>
// Страницы диапазона + якоря заданий на них (для интерактивной читалки).
// RLS ограничивает чтение книгами своей организации / глобальными.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(request.url).searchParams
  const from = parseInt(sp.get('from') ?? '')
  const to = parseInt(sp.get('to') ?? '')
  if (isNaN(from) || isNaN(to) || to < from || to - from > 60) {
    return Response.json({ error: 'Invalid range (max 60 pages)' }, { status: 400 })
  }

  const [pagesRes, problemsRes] = await Promise.all([
    supabase
      .from('book_pages')
      .select('page_index, printed_page, markdown')
      .eq('book_id', id)
      .gte('page_index', from)
      .lte('page_index', to)
      .order('page_index'),
    supabase
      .from('book_problems')
      .select('id, task_number, task_number_sort, page_index, md_start, md_end, answer_source, difficulty, grading_method, used_count')
      .eq('book_id', id)
      .eq('is_active', true)
      .gte('page_index', from)
      .lte('page_index', to)
      .order('page_index')
      .order('md_start'),
  ])

  if (pagesRes.error) return Response.json({ error: pagesRes.error.message }, { status: 500 })
  if (problemsRes.error) return Response.json({ error: problemsRes.error.message }, { status: 500 })

  return Response.json({
    pages: pagesRes.data ?? [],
    problems: problemsRes.data ?? [],
  })
}
