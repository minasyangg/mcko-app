import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export interface TestUsage {
  test_id: string
  title: string
  /** Сколько учеников уже решали — если больше нуля, тест удаляется мягко */
  attempts: number
  /** Действующие назначения (ученикам и группам) */
  assignments: number
  /** Назначения, привязанные к темам учебных программ */
  roadmap_items: number
  /** Что произойдёт при удалении: физически или скрытием */
  mode: 'hard' | 'soft'
}

/**
 * Считает, что зацеплено за тестами, и решает способ удаления.
 *
 * Правило (вариант «А», выбран пользователем): тест, который никто не решал,
 * удаляется физически — терять нечего. Тест с попытками только помечается
 * скрытым, потому что физическое удаление уносит и результаты учеников
 * (student_final_results ссылается на test_versions с ON DELETE CASCADE,
 * а прежний код удаления вдобавок вручную стирал attempts).
 */
export async function analyzeTestUsage(
  admin: AdminClient,
  testIds: string[],
): Promise<TestUsage[]> {
  if (testIds.length === 0) return []

  const { data: tests } = await admin
    .from('tests').select('id, title').in('id', testIds)

  const { data: versions } = await admin
    .from('test_versions').select('id, test_id').in('test_id', testIds)

  const versionsByTest = new Map<string, string[]>()
  for (const v of versions ?? []) {
    // test_id в схеме nullable — осиротевшие версии в расчёт не берём
    if (!v.test_id) continue
    const arr = versionsByTest.get(v.test_id) ?? []
    arr.push(v.id)
    versionsByTest.set(v.test_id, arr)
  }

  const allVersionIds = (versions ?? []).map(v => v.id)
  const { data: assignments } = allVersionIds.length
    ? await admin
        .from('assignments')
        .select('id, test_version_id, roadmap_topic_id')
        .in('test_version_id', allVersionIds)
    : { data: [] as { id: string; test_version_id: string; roadmap_topic_id: string | null }[] }

  const asgnIds = (assignments ?? []).map(a => a.id)
  const { data: attempts } = asgnIds.length
    ? await admin.from('attempts').select('id, assignment_id').in('assignment_id', asgnIds)
    : { data: [] as { id: string; assignment_id: string }[] }

  const asgnToTest = new Map<string, string>()
  for (const a of assignments ?? []) {
    for (const [testId, vids] of versionsByTest) {
      if (vids.includes(a.test_version_id)) { asgnToTest.set(a.id, testId); break }
    }
  }

  return (tests ?? []).map(t => {
    const vids = versionsByTest.get(t.id) ?? []
    const own = (assignments ?? []).filter(a => vids.includes(a.test_version_id))
    const attemptCount = (attempts ?? []).filter(a => asgnToTest.get(a.assignment_id) === t.id).length
    return {
      test_id: t.id,
      title: t.title,
      attempts: attemptCount,
      assignments: own.length,
      roadmap_items: own.filter(a => a.roadmap_topic_id != null).length,
      mode: attemptCount > 0 ? 'soft' : 'hard',
    }
  })
}

/**
 * Удаляет один тест по правилу из analyzeTestUsage.
 *
 * hard — вычищает всё: задания, ключи, картинки, разборы, документы, задания
 * парсинга, назначения. Попыток там нет по определению (иначе был бы soft).
 * soft — только помечает deleted_at: попытки, ответы и накопительные итоги
 * учеников остаются нетронутыми, иначе статистика стала бы нереальной.
 */
export async function deleteTest(
  admin: AdminClient,
  testId: string,
  mode: 'hard' | 'soft',
): Promise<{ ok: true; mode: 'hard' | 'soft' } | { ok: false; error: string }> {
  if (mode === 'soft') {
    const patch: { deleted_at: string; is_active: boolean } = {
      deleted_at: new Date().toISOString(),
      is_active: false,
    }
    const { error } = await admin.from('tests').update(patch).eq('id', testId)
    return error ? { ok: false, error: error.message } : { ok: true, mode: 'soft' }
  }

  const { data: versions } = await admin
    .from('test_versions').select('id').eq('test_id', testId)
  const versionIds = (versions ?? []).map(v => v.id)

  if (versionIds.length > 0) {
    const { data: tasks } = await admin
      .from('test_tasks').select('id').in('test_version_id', versionIds)
    const taskIds = (tasks ?? []).map(t => t.id)

    if (taskIds.length > 0) {
      // Картинки заданий: сначала файлы из Storage, потом строки
      const { data: media } = await admin
        .from('task_media').select('storage_path').in('task_id', taskIds)
      const paths = (media ?? []).map(m => m.storage_path).filter(Boolean) as string[]
      if (paths.length > 0) await admin.storage.from('task-media').remove(paths)

      await admin.from('task_answer_keys').delete().in('task_id', taskIds)
      await admin.from('task_media').delete().in('task_id', taskIds)
      await admin.from('task_solutions').delete().in('task_id', taskIds)
      await admin.from('solution_requests').delete().in('task_id', taskIds)
      await admin.from('parsing_warnings').delete().in('task_id', taskIds)
      await admin.from('test_tasks').delete().in('id', taskIds)
    }

    const { data: jobs } = await admin
      .from('parsing_jobs').select('id').in('test_version_id', versionIds)
    const jobIds = (jobs ?? []).map(j => j.id)
    if (jobIds.length > 0) {
      await admin.from('parsing_warnings').delete().in('parsing_job_id', jobIds)
      await admin.from('parsing_jobs').delete().in('id', jobIds)
    }

    await admin.from('test_documents').delete().in('test_version_id', versionIds)

    // Назначения без попыток (иначе режим был бы soft) — просто убираем
    const { data: assignments } = await admin
      .from('assignments').select('id').in('test_version_id', versionIds)
    const asgnIds = (assignments ?? []).map(a => a.id)
    if (asgnIds.length > 0) {
      await admin.from('student_final_results').delete().in('assignment_id', asgnIds)
      await admin.from('assignments').delete().in('id', asgnIds)
    }

    // Ссылка теста на опубликованную версию мешает удалить версии
    await admin.from('tests').update({ current_published_version_id: null }).eq('id', testId)
    await admin.from('test_versions').delete().in('id', versionIds)
  }

  const { error } = await admin.from('tests').delete().eq('id', testId)
  return error ? { ok: false, error: error.message } : { ok: true, mode: 'hard' }
}
