import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateAndSaveAnswer } from '@/lib/ai/generate-answer'
import { addBookProblemToVersion } from '@/lib/tests/add-problem-to-version'
import { NextRequest, after } from 'next/server'

// Фоновая ИИ-генерация ответа (after) может занять до 30 c
export const maxDuration = 60

// POST /api/books/problems/[id]/add-to-test
// Body: { test_version_id: string, task_number?: number, max_score?: number }
// Копирует задание из книги в тест (зеркало library add-to-test).
// Если у задания нет ответа — после ответа клиенту ИИ решает его в фоне и
// создаёт ключ для только что созданного test_task (answer_source='ai').
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: bookProblemId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json() as {
    test_version_id: string
    task_number?:    number
    max_score?:      number
  }

  if (!body.test_version_id) {
    return Response.json({ error: 'test_version_id required' }, { status: 400 })
  }

  // Версия теста должна принадлежать организации учителя
  const { data: tv } = await supabase
    .from('test_versions')
    .select('id, status, test_id, tests!test_id(organization_id)')
    .eq('id', body.test_version_id)
    .single()

  const tvOrgId = (tv?.tests as unknown as { organization_id: string } | null)?.organization_id
  if (!tv || tvOrgId !== profile.organization_id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (tv.status === 'published') {
    return Response.json({ error: 'Нельзя добавлять задания в опубликованную версию' }, { status: 422 })
  }

  const admin = createAdminClient()

  const result = await addBookProblemToVersion(admin, {
    testVersionId: body.test_version_id,
    bookProblemId,
    taskNumber: body.task_number,
    maxScore: body.max_score,
  })
  if (!result.ok) {
    const status = result.error === 'Book problem not found' ? 404 : 500
    return Response.json({ error: result.error }, { status })
  }

  // Нет ответа — решаем ИИ в фоне и вешаем ключ на созданный task
  const aiAnswerPending = !result.hasAnswer && !result.hasImages && !!process.env.DEEPSEEK_API_KEY
  if (aiAnswerPending) {
    after(() => generateAndSaveAnswer({ source: 'book', problemId: bookProblemId, taskId: result.taskId, admin }))
  }

  return Response.json({ ok: true, task_id: result.taskId, task_number: result.taskNumber, ai_answer_pending: aiAnswerPending })
}
