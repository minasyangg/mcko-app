import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

// GET /api/library/problems?exam_type=ОГЭ&subject=Физика&topic_id=...&q=...&page=1&per_page=20
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const exam_type        = searchParams.get('exam_type')
  const subject          = searchParams.get('subject')
  const grade            = searchParams.get('grade')
  const topic_id         = searchParams.get('topic_id')
  const task_number_type = searchParams.get('task_number_type')
  const q                = searchParams.get('q')
  const page             = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const per_page         = Math.min(50, Math.max(1, parseInt(searchParams.get('per_page') ?? '20')))
  const from             = (page - 1) * per_page
  const to               = from + per_page - 1

  let query = supabase
    .from('library_problems')
    .select(`
      id, exam_type, subject, grade,
      topic_id, task_number_type, source_id, source_domain,
      prompt_text, task_type, correct_answer, grading_method,
      default_max_score, has_solution:solution_html
    `, { count: 'exact' })
    .eq('is_active', true)
    .order('task_number_type', { ascending: true })
    .order('source_id', { ascending: true })
    .range(from, to)

  if (exam_type)        query = query.eq('exam_type', exam_type)
  if (subject)          query = query.eq('subject', subject)
  if (grade)            query = query.eq('grade', grade)
  if (topic_id)         query = query.eq('topic_id', topic_id)
  if (task_number_type) query = query.eq('task_number_type', task_number_type)
  if (q?.trim())        query = query.textSearch('prompt_text', q.trim(), { config: 'russian' })

  const { data, count, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({
    data:       data ?? [],
    total:      count ?? 0,
    page,
    per_page,
    total_pages: Math.ceil((count ?? 0) / per_page),
  })
}
