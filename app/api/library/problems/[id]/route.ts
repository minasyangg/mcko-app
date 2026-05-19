import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

// GET /api/library/problems/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: problem, error } = await supabase
    .from('library_problems')
    .select(`
      *,
      library_topics ( id, fipicod, name, exam_type, subject ),
      library_problem_media ( id, storage_path, placement, sort_order, alt_text )
    `)
    .eq('id', id)
    .eq('is_active', true)
    .single()

  if (error || !problem) return Response.json({ error: 'Not found' }, { status: 404 })

  return Response.json(problem)
}
