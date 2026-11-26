import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { createSimpleTest } from '@/lib/tests/simple-test'
import { zUuid } from '@/lib/uuid'

// Работа по PDF — бланк ответов (tests.answer_sheet, миграция 116).
//
// Файлы PDF браузер учителя заранее кладёт в test-documents сам (как
// ImportFlow: тело запроса к функции Vercel ограничено ~4.5 МБ, а вариант
// работы бывает больше) под префикс ANSWER_SHEET_PREFIX, а сюда передаёт
// только пути. Роут создаёт тест сразу опубликованным (createSimpleTest):
// задания «Задание N» без условия (условие — в PDF), необязательный ключ
// ответов — задания с ключом проверяются автоматически, без ключа уходят
// учителю.

const ANSWER_SHEET_PREFIX = 'answer-sheets/'
const BUCKET = 'test-documents'

const schema = z.object({
  title: z.string().trim().min(1, 'Укажите название').max(200),
  subject: z.string().trim().max(100).optional().nullable(),
  kind: z.enum(['test', 'homework']).default('test'),
  scoring_rule_id: zUuid().optional().nullable(),
  tasks: z.array(z.object({
    max_score: z.number().positive().max(100),
    // несколько верных вариантов — через «|», как в остальных ключах
    answer: z.string().trim().max(500).optional().nullable(),
  })).min(1, 'Добавьте хотя бы одно задание').max(100),
  files: z.array(z.object({
    path: z.string().startsWith(ANSWER_SHEET_PREFIX).max(500),
    name: z.string().trim().min(1).max(255),
  })).min(1, 'Прикрепите файл работы').max(5),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role) || !profile.organization_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const body = parsed.data
  const admin = createAdminClient()

  // Файлы действительно загружены: путь answer-sheets/<папка>/<имя> —
  // сверяем листингом папки, а не доверяем пути из запроса
  for (const f of body.files) {
    const rel = f.path.slice(ANSWER_SHEET_PREFIX.length)
    const slash = rel.lastIndexOf('/')
    if (slash <= 0 || rel.includes('..')) {
      return NextResponse.json({ error: 'Некорректный путь файла' }, { status: 400 })
    }
    const { data: listed } = await admin.storage.from(BUCKET)
      .list(ANSWER_SHEET_PREFIX + rel.slice(0, slash), { search: rel.slice(slash + 1), limit: 10 })
    if (!listed?.some(o => o.name === rel.slice(slash + 1))) {
      return NextResponse.json({ error: `Файл «${f.name}» не загружен` }, { status: 400 })
    }
  }

  const created = await createSimpleTest(admin, {
    orgId: profile.organization_id,
    userId: user.id,
    title: body.title,
    subject: body.subject,
    kind: body.kind,
    scoringRuleId: body.scoring_rule_id,
    tasks: body.tasks,
    answerSheet: true,
    files: body.files,
  })
  if (!created.ok) {
    // недосозданный тест остаётся черновиком — его видно в списке тестов,
    // учитель удалит или исправит
    const suffix = created.testId ? '. Работа сохранена черновиком в «Тестах».' : ''
    return NextResponse.json({ error: created.error + suffix }, { status: 500 })
  }

  return NextResponse.json({ test_id: created.testId, title: body.title }, { status: 201 })
}
