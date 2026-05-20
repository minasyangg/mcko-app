import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

// GET /api/library/topics?exam_type=ОГЭ&subject=Физика
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const exam_type = searchParams.get('exam_type')
  const subject   = searchParams.get('subject')
  const grade     = searchParams.get('grade')

  let query = supabase
    .from('library_topics')
    .select('id, exam_type, subject, grade, fipicod, name, parent_id, sort_order')
    .order('sort_order', { ascending: true })
    .order('fipicod', { ascending: true })

  if (exam_type) query = query.eq('exam_type', exam_type)
  if (subject)   query = query.eq('subject', subject)
  if (grade)     query = query.eq('grade', grade)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json(data ?? [])
}
