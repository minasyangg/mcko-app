import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

// PATCH /api/library/problems/[id]
// Body: { correct_answer: string }
// Учитель добавляет/исправляет ответ к задаче вручную
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Доступ к задаче через user-клиент: RLS пускает только к глобальным
  // задачам либо задачам своей организации. Чужая org-задача → 404.
  const { data: existing } = await supabase
    .from('library_problems').select('id').eq('id', id).eq('is_active', true).single()
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

  const body = await request.json() as { correct_answer?: string }
  const rawAnswer = body.correct_answer?.trim() ?? ''

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('library_problems')
    .update({
      correct_answer: rawAnswer === '' ? null : rawAnswer,
      answer_source: rawAnswer === '' ? 'none' : 'manual',
    })
    .eq('id', id)
    .select('id, correct_answer, has_answer, answer_source')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

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
