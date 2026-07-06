import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

// GET /api/books/[id]/search?q=<номер задания или текст>
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const q = new URL(request.url).searchParams.get('q')?.trim()
  if (!q) return Response.json({ results: [] })

  let query = supabase
    .from('book_problems')
    .select('id, task_number, task_number_sort, section_id, page_index, prompt_md, answer_source')
    .eq('book_id', id)
    .eq('is_active', true)
    .limit(30)

  if (/^\d{1,4}(\.\d{1,3})?$/.test(q)) {
    // точный номер задания: «735» или «5.30» (нумерация по параграфам)
    query = query.eq('task_number', q)
  } else {
    query = query.textSearch('prompt_md', q, { config: 'russian' })
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const results = (data ?? []).map(p => ({
    id: p.id,
    task_number: p.task_number,
    section_id: p.section_id,
    page_index: p.page_index,
    answer_source: p.answer_source,
    snippet: p.prompt_md.replace(/\s+/g, ' ').slice(0, 160),
  }))

  return Response.json({ results })
}
