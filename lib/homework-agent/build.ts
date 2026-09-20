/**
 * ────────────────────────────────────────────────────────────────────────
 * СПРАВОЧНЫЙ ФАЙЛ — НЕ ИСПОЛНЯЕТСЯ, НИОТКУДА НЕ ИМПОРТИРУЕТСЯ.
 * ────────────────────────────────────────────────────────────────────────
 *
 * Автоматическая сборка ДЗ на сервере удалена (2026-09-20, по решению
 * пользователя): ДЗ собирает Claude Code скиллом
 * .claude/skills/homework-agent-build, читая текст каждого кандидата и
 * отбирая задания по смыслу — слепой SQL-фильтр по теме в первом живом
 * прогоне (2026-09-16) собрал ДЗ из посторонних разделов. Вместе с cron
 * (app/api/cron/homework-agent/*) удалены propose.ts, pick-problems.ts,
 * format-message.ts.
 *
 * Этот файл оставлен НАМЕРЕННО и только как образец структуры для скилла:
 * какие таблицы и в каком порядке заполняются при сборке ДЗ (tests →
 * test_versions → test_tasks/task_answer_keys → publish → assignments),
 * с каким набором колонок. SKILL.md ссылается на него как на эталон
 * SQL-эквивалента. Живые реализации вставки задания и публикации —
 * lib/tests/add-problem-to-version.ts и lib/tests/publish.ts, они
 * используются HTTP-роутами и актуальны.
 *
 * Код ниже приведён как он работал на момент удаления автосборки. Он
 * ссылается на удалённый pickProblems — это осознанно: описание того,
 * ЧТО подставить на его место, есть в SKILL.md (шаги 3–4, смысловой
 * отбор). Не восстанавливать этот путь, не импортировать отсюда ничего.
 *
 * @fileoverview Образец структуры сборки ДЗ. Не исполняемый код.
 */
/* eslint-disable */
// @ts-nocheck
export async function buildHomework(
  admin: AdminClient,
  proposalId: string
): Promise<BuildResult> {
  // Атомарный захват: если строка уже не в 'confirmed' (гонка cron+callback,
  // либо повторный вызов), rowCount будет 0 — не билдим дважды.
  const { data: claimed, error: claimError } = await admin
    .from('homework_proposals')
    .update({ status: 'building', updated_at: new Date().toISOString() })
    .eq('id', proposalId)
    .eq('status', 'confirmed')
    .select('*')
    .single()

  if (claimError || !claimed) return { ok: false, reason: 'race' }

  try {
    const result = await doBuild(admin, claimed)
    if (result.ok) {
      await admin.from('homework_proposals').update({
        status: 'built',
        test_id: result.testId,
        assignment_id: result.assignmentId,
        updated_at: new Date().toISOString(),
      }).eq('id', proposalId)
    } else {
      await admin.from('homework_proposals').update({
        status: 'failed',
        build_error: result.reason === 'shortfall'
          ? 'Не хватило заданий по теме — соберите ДЗ вручную.'
          : (result.error ?? 'Неизвестная ошибка сборки'),
        updated_at: new Date().toISOString(),
      }).eq('id', proposalId)
    }
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await admin.from('homework_proposals').update({
      status: 'failed',
      build_error: message,
      updated_at: new Date().toISOString(),
    }).eq('id', proposalId)
    return { ok: false, reason: 'error', error: message }
  }
}

interface ProposalRow {
  id: string
  roadmap_id: string
  rule_id: string | null
  organization_id: string
  teacher_id: string
  roadmap_topic_id: string | null
  proposed_title: string
  final_title: string | null
  rationale: unknown
  publish_immediately: boolean
}

async function doBuild(admin: AdminClient, proposal: ProposalRow): Promise<BuildResult> {
  if (!proposal.rule_id) return { ok: false, reason: 'error', error: 'У предложения нет привязанного правила' }
  if (!proposal.roadmap_topic_id) return { ok: false, reason: 'error', error: 'У предложения нет темы кодификатора' }

  const { data: rule } = await admin
    .from('roadmap_agent_rules')
    .select('*')
    .eq('id', proposal.rule_id)
    .single()
  if (!rule) return { ok: false, reason: 'error', error: 'Правило не найдено' }

  const { data: sourceRows } = await admin
    .from('roadmap_agent_rule_sources')
    .select('*')
    .eq('rule_id', proposal.rule_id)
  const sources: RuleSource[] = (sourceRows ?? []).map(s => ({
    sourceKind: s.source_kind as RuleSource['sourceKind'],
    bookId: s.book_id,
    libraryTopicId: s.library_topic_id,
    examType: s.exam_type,
    subject: s.subject,
    weight: s.weight,
  }))
  if (sources.length === 0) return { ok: false, reason: 'error', error: 'У правила не настроены источники заданий' }

  const { data: roadmap } = await admin
    .from('roadmaps')
    .select('group_id')
    .eq('id', proposal.roadmap_id)
    .single()
  if (!roadmap?.group_id) return { ok: false, reason: 'error', error: 'У программы нет группы' }

  const { data: members } = await admin
    .from('group_members')
    .select('user_id')
    .eq('group_id', roadmap.group_id)
  const studentIds = (members ?? []).map(m => m.user_id)

  // homework_proposals.roadmap_topic_id — это roadmap_topics.id (тема
  // программы), а pickProblems работает с темой КОДИФИКАТОРА
  // (library_topics.id) — они связаны через roadmap_topics.library_topic_id,
  // проставленный при развороте программы из fgos_curriculum (080).
  const { data: roadmapTopic } = await admin
    .from('roadmap_topics')
    .select('library_topic_id')
    .eq('id', proposal.roadmap_topic_id)
    .single()
  if (!roadmapTopic?.library_topic_id) {
    return { ok: false, reason: 'error', error: 'У темы программы нет привязки к теме кодификатора' }
  }

  const ruleConfig: RuleConfig = {
    taskCount: rule.task_count,
    mistakesPct: rule.mistakes_pct,
    difficulty: rule.difficulty as RuleConfig['difficulty'],
    allowImages: rule.allow_images,
    requireAnswer: rule.require_answer,
    dedupWindowDays: 60, // окно «не повторять то же самое недавнее» — фиксировано, не завязано на mistakes_lookback_days (тот про поиск ошибок, не про дедуп)
  }

  const picked = await pickProblems(admin, {
    libraryTopicId: roadmapTopic.library_topic_id,
    teacherId: proposal.teacher_id,
    studentIds,
    rule: ruleConfig,
    sources,
  })

  if (picked.shortfall) return { ok: false, reason: 'shortfall' }

  // Черновик теста
  const title = proposal.final_title ?? proposal.proposed_title
  const { data: test, error: testErr } = await admin
    .from('tests')
    .insert({
      organization_id: proposal.organization_id,
      title,
      kind: 'homework',
      status: 'draft',
      created_by: proposal.teacher_id,
    })
    .select('id')
    .single()
  if (testErr || !test) return { ok: false, reason: 'error', error: testErr?.message ?? 'Не удалось создать тест' }

  const { data: version, error: versionErr } = await admin
    .from('test_versions')
    .insert({ test_id: test.id, version_number: 1, status: 'draft' })
    .select('id')
    .single()
  if (versionErr || !version) return { ok: false, reason: 'error', error: versionErr?.message ?? 'Не удалось создать версию теста' }

  let taskNumber = 1
  for (const p of picked.picked) {
    const result = p.source === 'book'
      ? await addBookProblemToVersion(admin, {
          testVersionId: version.id,
          bookProblemId: p.problemId,
          taskNumber: taskNumber++,
          maxScore: p.maxScore,
        })
      : await addLibraryProblemToVersion(admin, {
          testVersionId: version.id,
          libraryProblemId: p.problemId,
          taskNumber: taskNumber++,
          maxScore: p.maxScore,
          organizationId: proposal.organization_id,
        })
    if (!result.ok) {
      // Незавершённый черновик оставляем — учитель может доделать вручную
      // через обычный редактор теста, не теряя уже вставленные задания.
      return { ok: false, reason: 'error', error: `Задание ${p.problemId}: ${result.error}` }
    }
  }

  // По умолчанию — черновик: учитель проверяет состав перед тем, как его
  // увидит группа. Публикация и назначение — только по явному
  // publish_immediately (чекбокс на странице подтверждения). Найдено при
  // первом живом прогоне 2026-09-16: безусловная публикация не оставляла
  // учителю шанса проверить состав до того, как ДЗ уже ушло ученикам.
  if (!proposal.publish_immediately) {
    return {
      ok: true,
      testId: test.id,
      assignmentId: null,
      published: false,
      taskCount: picked.picked.length,
      relaxations: picked.relaxations,
    }
  }

  const publishResult = await publishTestVersion(admin, version.id, proposal.teacher_id)
  if (!publishResult.ok) return { ok: false, reason: 'error', error: publishResult.error }

  const { data: publishedTest } = await admin
    .from('tests')
    .select('current_published_version_id')
    .eq('id', test.id)
    .single()

  const { data: assignment, error: assignErr } = await admin
    .from('assignments')
    .insert({
      test_version_id: publishedTest?.current_published_version_id ?? version.id,
      organization_id: proposal.organization_id,
      group_id: roadmap.group_id,
      student_id: null,
      roadmap_topic_id: proposal.roadmap_topic_id,
      kind: 'homework',
      starts_at: null,
      ends_at: null,
      max_attempts: 1,
      created_by: proposal.teacher_id,
    })
    .select('id')
    .single()

  if (assignErr || !assignment) {
    // Тест опубликован, но назначить не удалось — откатывать публикацию не
    // нужно (тест валиден сам по себе, учитель может назначить его вручную).
    return { ok: false, reason: 'error', error: assignErr?.message ?? 'Не удалось создать назначение' }
  }

  await notifyAssignmentCreated(assignment.id).catch(() => {}) // уведомление не должно ронять сборку

  return {
    ok: true,
    testId: test.id,
    assignmentId: assignment.id,
    published: true,
    taskCount: picked.picked.length,
    relaxations: picked.relaxations,
  }
}
