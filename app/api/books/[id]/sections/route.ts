import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

// GET /api/books/[id]/sections
// Полное дерево содержания книги — для обновления сайдбара после
// редактирования/удаления главы без перезагрузки страницы.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('book_sections')
    .select('id, parent_id, kind, number, title, page_start, page_end, sort_order')
    .eq('book_id', id)
    .order('sort_order')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ sections: data ?? [] })
}
