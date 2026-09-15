import type { createClient } from '@/lib/supabase/server'
import type { createAdminClient } from '@/lib/supabase/admin'

type Db = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>

/**
 * Переводит версию теста в published — единственный путь draft→published.
 * Вынесено из POST /api/tests/versions/[versionId]/publish, чтобы им мог
 * пользоваться и HTTP-роут (RLS-клиент, есть auth.uid()), и агент
 * автосборки ДЗ (admin-клиент, cron не залогинен) — принимает клиент
 * параметром вместо того, чтобы создавать его самому.
 *
 * Гейт review_status: если хоть одно задание версии в 'pending'/'needs_fix',
 * публикация отклоняется — вставляющий задания код обязан сразу проставлять
 * review_status='approved' (см. lib/tests/add-problem-to-version.ts).
 */
export async function publishTestVersion(
  db: Db,
  versionId: string,
  publishedBy: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { data: blockingTasks, error: tasksError } = await db
    .from('test_tasks')
    .select('id')
    .eq('test_version_id', versionId)
    .in('review_status', ['pending', 'needs_fix'])
    .limit(1)

  if (tasksError) return { ok: false, error: tasksError.message, status: 500 }
  if (blockingTasks && blockingTasks.length > 0) {
    return {
      ok: false,
      error: 'Есть задания, требующие проверки. Одобрите или отклоните все задания перед публикацией.',
      status: 422,
    }
  }

  const { data: version, error: versionError } = await db
    .from('test_versions')
    .select('id, test_id')
    .eq('id', versionId)
    .single()

  if (versionError || !version) return { ok: false, error: 'Version not found', status: 404 }

  const now = new Date().toISOString()

  const { error: publishVersionError } = await db
    .from('test_versions')
    .update({ status: 'published', published_at: now, published_by: publishedBy })
    .eq('id', versionId)

  if (publishVersionError) return { ok: false, error: publishVersionError.message, status: 500 }

  if (version.test_id) {
    const { error: publishTestError } = await db
      .from('tests')
      .update({ status: 'published', is_active: true, current_published_version_id: versionId, updated_at: now })
      .eq('id', version.test_id)

    // Не блокирует публикацию версии — как и в исходном роуте, только
    // логируется: версия уже published, это вторичное обновление витрины.
    if (publishTestError) console.error('[publishTestVersion] test update error:', publishTestError)
  }

  return { ok: true }
}
