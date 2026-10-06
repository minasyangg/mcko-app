import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/supabase/auth-user'

// GET /api/library/topics?exam_type=ОГЭ&subject=Физика
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await getAuthUser(supabase)
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  // exam_type — повторяемый параметр, см. app/api/library/problems/route.ts
  const examTypes = searchParams.getAll('exam_type').filter(Boolean)
  const subject   = searchParams.get('subject')
  const grade     = searchParams.get('grade')

  let query = supabase
    .from('library_topics')
    .select('id, exam_type, subject, grade, fipicod, name, parent_id, sort_order')
    .order('sort_order', { ascending: true })
    .order('fipicod', { ascending: true })

  if (examTypes.length > 0) query = query.in('exam_type', examTypes)
  if (subject)              query = query.eq('subject', subject)
  if (grade)                query = query.eq('grade', grade)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json(data ?? [])
}
