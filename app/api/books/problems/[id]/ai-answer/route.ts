import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeBookEdit } from '@/lib/books/authorize'
import { generateAndSaveAnswer } from '@/lib/ai/generate-answer'
import { NextRequest } from 'next/server'

// Решение DeepSeek занимает 5-30 c — дефолтного таймаута может не хватить
export const maxDuration = 60

// POST /api/books/problems/[id]/ai-answer
// Генерирует эталонный ответ ИИ для задания книги без ответа
// (answer_source='ai'). Права — как у PATCH задания: владелец книги,
// учитель с грантом (book_editors) или admin.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const admin = createAdminClient()
  const { data: problem } = await admin
    .from('book_problems')
    .select('id, book_id, correct_answer, has_images')
    .eq('id', id)
    .single()
  if (!problem) return Response.json({ error: 'Not found' }, { status: 404 })

  const auth = await authorizeBookEdit(problem.book_id)
  if (auth.error) return auth.error

  if (problem.correct_answer !== null) {
    return Response.json({ error: 'У задания уже есть ответ' }, { status: 409 })
  }
  if (problem.has_images) {
    return Response.json({ error: 'Задание с изображением — ИИ-решение недоступно' }, { status: 422 })
  }

  const result = await generateAndSaveAnswer({ source: 'book', problemId: id, admin })
  if (!result) {
    return Response.json({ error: 'ИИ не смог уверенно решить задание. Добавьте ответ вручную.' }, { status: 422 })
  }

  return Response.json({
    ok: true,
    correct_answer: { text: result.answerText },
    grading_method: result.gradingMethod,
    answer_source: 'ai',
  })
}
