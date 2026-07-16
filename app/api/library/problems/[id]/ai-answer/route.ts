import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateAndSaveAnswer } from '@/lib/ai/generate-answer'
import { NextRequest } from 'next/server'

// Решение DeepSeek занимает 5-30 c — дефолтного таймаута может не хватить
export const maxDuration = 60

// POST /api/library/problems/[id]/ai-answer
// Генерирует эталонный ответ ИИ для задачи библиотеки без ответа
// (answer_source='ai'). Права — как у PATCH: teacher/admin, задача глобальная
// или своей организации (RLS-чтение как гейт).
export async function POST(
  _request: NextRequest,
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
  const { data: problem } = await supabase
    .from('library_problems')
    .select('id, correct_answer, library_problem_media(placement)')
    .eq('id', id)
    .eq('is_active', true)
    .single()
  if (!problem) return Response.json({ error: 'Not found' }, { status: 404 })

  if (problem.correct_answer !== null) {
    return Response.json({ error: 'У задачи уже есть ответ' }, { status: 409 })
  }
  const media = (problem.library_problem_media as { placement: string | null }[] | null) ?? []
  if (media.some(m => m.placement !== 'solution')) {
    return Response.json({ error: 'Задача с изображением — ИИ-решение недоступно' }, { status: 422 })
  }

  const admin = createAdminClient()
  const result = await generateAndSaveAnswer({ source: 'library', problemId: id, admin })
  if (!result) {
    return Response.json({ error: 'ИИ не смог уверенно решить задачу. Добавьте ответ вручную.' }, { status: 422 })
  }

  return Response.json({
    ok: true,
    correct_answer: result.answerText,
    grading_method: result.gradingMethod,
    answer_source: 'ai',
    has_answer: true,
  })
}
