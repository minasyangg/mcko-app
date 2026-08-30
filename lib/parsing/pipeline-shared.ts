// Общие хелперы конвейера импорта теста, используемые несколькими роутами:
// app/api/parsing/trigger (все ветки), app/api/parsing/jobs/[id] (довершает
// PDF-ветку после PaddleOCR), app/api/tests/versions/[versionId]/approve-all.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type AdminClient = SupabaseClient<Database>

// ─── Apply scoring rules ──────────────────────────────────────────────────────

export async function applyMatchingScoringRules(
  client: AdminClient,
  testVersionId: string
): Promise<number> {
  const { data: version } = await client
    .from('test_versions')
    .select('test_id')
    .eq('id', testVersionId)
    .single()
  if (!version?.test_id) return 0

  const { data: test } = await client
    .from('tests')
    .select('organization_id, exam_type, grade, subject')
    .eq('id', version.test_id)
    .single()
  if (!test?.organization_id) return 0

  const { data: rules } = await client
    .from('scoring_rules')
    .select('id, exam_type, grade, subject, scoring_rule_items ( task_number, max_score )')
    .eq('organization_id', test.organization_id)
  if (!rules?.length) return 0

  // Normalize for case-insensitive, trim-insensitive comparison
  const norm = (s: string | null) => s?.trim().toLowerCase() ?? null

  // Pick the most specific matching rule (null field = wildcard, non-null must match exactly)
  let bestRule: typeof rules[0] | null = null
  let bestScore = -1

  for (const rule of rules) {
    let score = 0
    let mismatch = false

    if (rule.exam_type !== null) {
      if (norm(rule.exam_type) === norm(test.exam_type)) score++
      else { mismatch = true }
    }
    if (rule.grade !== null) {
      if (norm(rule.grade) === norm(test.grade)) score++
      else { mismatch = true }
    }
    if (rule.subject !== null) {
      if (norm(rule.subject) === norm(test.subject)) score++
      else { mismatch = true }
    }

    if (!mismatch && score > bestScore) {
      bestScore = score
      bestRule = rule
    }
  }

  if (!bestRule) { console.log('[scoring-rules] no matching rule found'); return 0 }

  const items = (bestRule as any).scoring_rule_items as { task_number: number; max_score: number }[]
  if (!items?.length) return 0

  let updated = 0
  for (const item of items) {
    const { error } = await client
      .from('test_tasks')
      .update({ max_score: item.max_score })
      .eq('test_version_id', testVersionId)
      .eq('task_number', item.task_number)
    if (!error) updated++
  }

  console.log(`[scoring-rules] rule matched (score=${bestScore}), ${updated}/${items.length} tasks updated`)
  return updated
}

// ─── Exam type lookup (для выбора модуля парсинга по типу экзамена) ──────────

export async function getExamType(client: AdminClient, testVersionId: string): Promise<string | null> {
  const { data: version } = await client.from('test_versions').select('test_id').eq('id', testVersionId).single()
  if (!version?.test_id) return null
  const { data: test } = await client.from('tests').select('exam_type').eq('id', version.test_id).single()
  return test?.exam_type ?? null
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

// Delete all source documents from test-documents bucket after successful parsing.
// The original files are no longer needed once tasks are extracted into the DB.
export async function cleanupSourceDocuments(
  client: AdminClient,
  testVersionId: string
): Promise<void> {
  try {
    const { data: docs } = await client
      .from('test_documents')
      .select('storage_path')
      .eq('test_version_id', testVersionId)
    const paths = (docs ?? []).map((d) => d.storage_path).filter(Boolean)
    if (paths.length > 0) {
      await client.storage.from('test-documents').remove(paths)
      console.log(`[parsing] deleted ${paths.length} source document(s) from storage`)
    }
  } catch (err) {
    // Non-fatal: log but don't fail the job
    console.warn('[parsing] cleanupSourceDocuments failed:', err)
  }
}
