import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { publishTestVersion } from '@/lib/tests/publish'
import { zUuid } from '@/lib/uuid'

// Работа по PDF — бланк ответов (tests.answer_sheet, миграция 116).
//
// Файлы PDF браузер учителя заранее кладёт в test-documents сам (как
// ImportFlow: тело запроса к функции Vercel ограничено ~4.5 МБ, а вариант
// работы бывает больше) под префикс ANSWER_SHEET_PREFIX, а сюда передаёт
// только пути. Роут создаёт тест сразу опубликованным: задания «Задание N»
// без условия (условие — в PDF), необязательный ключ ответов — задания с
// ключом проверяются автоматически, без ключа уходят учителю.

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

  const { data: test, error: testError } = await admin.from('tests').insert({
    organization_id: profile.organization_id,
    created_by: user.id,
    title: body.title,
    subject: body.subject || null,
    kind: body.kind,
    status: 'draft',
    answer_sheet: true,
    scoring_rule_id: body.scoring_rule_id ?? null,
  }).select('id').single()
  if (testError || !test) {
    return NextResponse.json({ error: testError?.message ?? 'Не удалось создать работу' }, { status: 500 })
  }

  // Дальше при ошибке тест остаётся черновиком — его видно в списке тестов,
  // учитель удалит или исправит; опубликованным он становится только в конце
  const fail = (message: string) =>
    NextResponse.json({ error: `${message}. Работа сохранена черновиком в «Тестах».` }, { status: 500 })

  const { data: version, error: versionError } = await admin.from('test_versions').insert({
    test_id: test.id,
    version_number: 1,
    status: 'draft',
  }).select('id').single()
  if (versionError || !version) return fail(versionError?.message ?? 'Не удалось создать версию')

  const { data: tasks, error: tasksError } = await admin.from('test_tasks').insert(
    body.tasks.map((t, i) => ({
      test_version_id: version.id,
      task_number: i + 1,
      sort_order: i + 1,
      prompt_text: `Задание ${i + 1}`,
      task_type: 'short_text',
      grading_method: t.answer ? 'normalized' : 'manual',
      max_score: t.max_score,
      review_status: 'approved',
    }))
  ).select('id, task_number')
  if (tasksError || !tasks) return fail(tasksError?.message ?? 'Не удалось создать задания')

  const idByNumber = new Map(tasks.map(t => [t.task_number, t.id]))
  const keys = body.tasks
    .map((t, i) => ({ task_id: idByNumber.get(i + 1)!, answer: t.answer }))
    .filter((k): k is { task_id: string; answer: string } => !!k.answer)
  if (keys.length > 0) {
    const { error: keysError } = await admin.from('task_answer_keys').insert(
      keys.map(k => ({ task_id: k.task_id, correct_answer: k.answer, grading_method: 'normalized' }))
    )
    if (keysError) return fail(keysError.message)
  }

  const { error: docsError } = await admin.from('test_documents').insert(
    body.files.map(f => ({
      test_version_id: version.id,
      doc_type: 'variant',
      original_filename: f.name,
      storage_path: f.path,
      parse_status: 'done',
    }))
  )
  if (docsError) return fail(docsError.message)

  const published = await publishTestVersion(admin, version.id, user.id)
  if (!published.ok) return fail(published.error)

  return NextResponse.json({ test_id: test.id, title: body.title }, { status: 201 })
}
