import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { publishTestVersion } from '@/lib/tests/publish'

type AdminClient = SupabaseClient<Database>

// Тест из заданий «Задание N» без условий — общий для работы по PDF (бланк
// ответов, 116: условия в прикреплённых файлах) и очной работы «только
// баллы» (117: условий нет совсем, задания — скелет для баллов). Создаётся
// сразу опубликованным, как обычный тест, и виден в «Тестах».

export interface SimpleTestInput {
  orgId: string
  userId: string
  title: string
  subject?: string | null
  kind: 'test' | 'homework'
  scoringRuleId?: string | null
  /** несколько верных вариантов ответа — через «|», как в остальных ключах */
  tasks: { max_score: number; answer?: string | null }[]
  answerSheet?: boolean
  scoresOnly?: boolean
  /** файлы работы по PDF (test_documents, doc_type = 'variant') */
  files?: { path: string; name: string }[]
}

export type SimpleTestResult =
  | { ok: true; testId: string }
  // testId — тест успел создаться и остался черновиком
  | { ok: false; error: string; testId: string | null }

export async function createSimpleTest(admin: AdminClient, input: SimpleTestInput): Promise<SimpleTestResult> {
  const { data: test, error: testError } = await admin.from('tests').insert({
    organization_id: input.orgId,
    created_by: input.userId,
    title: input.title,
    subject: input.subject || null,
    kind: input.kind,
    status: 'draft',
    answer_sheet: input.answerSheet ?? false,
    scores_only: input.scoresOnly ?? false,
    scoring_rule_id: input.scoringRuleId ?? null,
  }).select('id').single()
  if (testError || !test) return { ok: false, error: testError?.message ?? 'Не удалось создать работу', testId: null }

  // Дальше при ошибке тест остаётся черновиком — опубликованным он
  // становится только в конце
  const fail = (error: string): SimpleTestResult => ({ ok: false, error, testId: test.id })

  const { data: version, error: versionError } = await admin.from('test_versions').insert({
    test_id: test.id,
    version_number: 1,
    status: 'draft',
  }).select('id').single()
  if (versionError || !version) return fail(versionError?.message ?? 'Не удалось создать версию')

  const { data: tasks, error: tasksError } = await admin.from('test_tasks').insert(
    input.tasks.map((t, i) => ({
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
  const keys = input.tasks
    .map((t, i) => ({ task_id: idByNumber.get(i + 1)!, answer: t.answer }))
    .filter((k): k is { task_id: string; answer: string } => !!k.answer)
  if (keys.length > 0) {
    const { error: keysError } = await admin.from('task_answer_keys').insert(
      keys.map(k => ({ task_id: k.task_id, correct_answer: k.answer, grading_method: 'normalized' }))
    )
    if (keysError) return fail(keysError.message)
  }

  if (input.files?.length) {
    const { error: docsError } = await admin.from('test_documents').insert(
      input.files.map(f => ({
        test_version_id: version.id,
        doc_type: 'variant',
        original_filename: f.name,
        storage_path: f.path,
        parse_status: 'done',
      }))
    )
    if (docsError) return fail(docsError.message)
  }

  const published = await publishTestVersion(admin, version.id, input.userId)
  if (!published.ok) return fail(published.error)

  return { ok: true, testId: test.id }
}
