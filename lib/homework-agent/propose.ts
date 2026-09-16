import type { createAdminClient } from '@/lib/supabase/admin'
import { diagnoseRoadmap, type TopicCandidate } from '@/lib/homework-agent/diagnose'
import { notifyUsers } from '@/lib/notifications/send'
import { formatProposalMessage, pluralOshibka } from '@/lib/homework-agent/format-message'

type AdminClient = ReturnType<typeof createAdminClient>

export interface ProposeOutcome {
  roadmapId: string
  ruleId: string
  outcome: 'created' | 'skipped_conflict' | 'skipped_no_candidate' | 'skipped_no_topic_link'
  proposalId?: string
}

/**
 * Фаза 1 двухфазного флоу: для каждого активного правила, чьё расписание
 * совпадает с сегодня, диагностирует тему (diagnose.ts), заводит
 * homework_proposals и уведомляет учителя. Идемпотентно — повторный вызов
 * в тот же день на ту же программу не создаёт второе предложение
 * (unique(roadmap_id, slot_date), см. 082).
 *
 * Вызывается из cron-роута app/api/cron/homework-agent/propose. Ничего не
 * билдит сама — только предлагает; сборка — build.ts, после подтверждения.
 */
export async function proposeForDueRules(admin: AdminClient): Promise<ProposeOutcome[]> {
  const dueRules = await loadDueRules(admin)
  const results: ProposeOutcome[] = []
  for (const rule of dueRules) {
    results.push(await proposeForRule(admin, rule))
  }
  return results
}

interface DueRule {
  id: string
  roadmap_id: string
  organization_id: string
  timezone: string
  confirm_timeout_hours: number
  auto_confirm: boolean
  mistakes_lookback_days: number
  roadmap_title: string
  roadmap_created_by: string
}

/**
 * Правила, у которых сегодня (в их часовом поясе) рабочий день по weekdays
 * и текущее локальное время уже прошло send_at_local. Отбор целиком в JS,
 * не SQL: часовые пояса правил разные, а PostgREST не даёт удобно выразить
 * "extract(isodow from now() at time zone weekdays[]" через .from() —
 * количество правил на программу мало (одно на roadmap), полный скан не
 * дорог.
 */
async function loadDueRules(admin: AdminClient): Promise<DueRule[]> {
  const { data: rules } = await admin
    .from('roadmap_agent_rules')
    .select('id, roadmap_id, organization_id, timezone, weekdays, send_at_local, confirm_timeout_hours, auto_confirm, mistakes_lookback_days, roadmaps!roadmap_id(title, created_by)')
    .eq('enabled', true)

  const due: DueRule[] = []
  for (const r of rules ?? []) {
    const roadmap = r.roadmaps as unknown as { title: string; created_by: string } | null
    if (!roadmap) continue
    if (!isDueNow(r.weekdays as number[], r.send_at_local, r.timezone)) continue
    due.push({
      id: r.id,
      roadmap_id: r.roadmap_id,
      organization_id: r.organization_id,
      timezone: r.timezone,
      confirm_timeout_hours: r.confirm_timeout_hours,
      auto_confirm: r.auto_confirm,
      mistakes_lookback_days: r.mistakes_lookback_days,
      roadmap_title: roadmap.title,
      roadmap_created_by: roadmap.created_by,
    })
  }
  return due
}

/** ISO-день недели (1=пн…7=вс) и локальное время в заданном часовом поясе через Intl — без внешних зависимостей. */
function isDueNow(weekdays: number[], sendAtLocal: string, timezone: string): boolean {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const weekdayShort = parts.find(p => p.type === 'weekday')?.value ?? ''
  const hour = parts.find(p => p.type === 'hour')?.value ?? '00'
  const minute = parts.find(p => p.type === 'minute')?.value ?? '00'

  const isoDow = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[weekdayShort]
  if (!isoDow || !weekdays.includes(isoDow)) return false

  const nowMinutes = parseInt(hour) * 60 + parseInt(minute)
  const [sendH, sendM] = sendAtLocal.split(':').map(Number)
  return nowMinutes >= sendH * 60 + sendM
}

async function findRoadmapTopicByLibraryTopic(
  admin: AdminClient,
  roadmapId: string,
  libraryTopicId: string
): Promise<{ id: string } | null> {
  const { data } = await admin
    .from('roadmap_topics')
    .select('id')
    .eq('roadmap_id', roadmapId)
    .eq('library_topic_id', libraryTopicId)
    .maybeSingle()
  return data
}

function localSlotDate(timezone: string): string {
  // en-CA даёт YYYY-MM-DD напрямую — единственный стандартный локаль-формат с этим порядком.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
}

async function proposeForRule(admin: AdminClient, rule: DueRule): Promise<ProposeOutcome> {
  const slotDate = localSlotDate(rule.timezone)

  const { data: existing } = await admin
    .from('homework_proposals')
    .select('id')
    .eq('roadmap_id', rule.roadmap_id)
    .eq('slot_date', slotDate)
    .maybeSingle()
  if (existing) return { roadmapId: rule.roadmap_id, ruleId: rule.id, outcome: 'skipped_conflict' }

  const { data: sources } = await admin
    .from('roadmap_agent_rule_sources')
    .select('source_kind, exam_type, subject')
    .eq('rule_id', rule.id)
    .eq('source_kind', 'library_exam')
  const examSources = (sources ?? [])
    .filter((s): s is { source_kind: string; exam_type: string; subject: string } => !!s.exam_type && !!s.subject)
    .map(s => ({ examType: s.exam_type, subject: s.subject }))

  const diagnosis = await diagnoseRoadmap(admin, {
    roadmapId: rule.roadmap_id,
    teacherId: rule.roadmap_created_by,
    lookbackDays: rule.mistakes_lookback_days,
    examSources,
  })

  if (!diagnosis.winner) return { roadmapId: rule.roadmap_id, ruleId: rule.id, outcome: 'skipped_no_candidate' }

  // roadmap_topics, соответствующая теме-победителю — нужен id именно
  // roadmap_topics (не library_topics) для homework_proposals.roadmap_topic_id
  // и дальнейшей сборки в build.ts (см. комментарий там же).
  //
  // Диагностика (diagnose_roadmap_mistakes) часто находит тему на уровне
  // РАЗДЕЛА кодификатора — там больше данных, т.к. задачи из PDF-тестов
  // (exam_task_topic_map) размечены по разделу, а не подразделу (см.
  // project_homework_agent). Банк задач (library_problems) при этом лежит
  // почти всегда на уровне ПОДРАЗДЕЛА — прямого совпадения по
  // library_topic_id может не быть, хотя тема программы явно про тот же
  // материал. Если точного совпадения нет и победитель — раздел (parent_id
  // is null), ищем среди тем программы любую, связанную с ЕГО подразделом
  // (library_topics.parent_id = winner.id) — pick-problems.ts получит
  // рабочий подраздел, где реально есть задачи, а не пустой раздел.
  let roadmapTopic = await findRoadmapTopicByLibraryTopic(admin, rule.roadmap_id, diagnosis.winner.libraryTopicId)
  if (!roadmapTopic) {
    const { data: winnerTopic } = await admin
      .from('library_topics')
      .select('parent_id')
      .eq('id', diagnosis.winner.libraryTopicId)
      .single()
    if (winnerTopic && winnerTopic.parent_id === null) {
      const { data: subtopics } = await admin
        .from('library_topics')
        .select('id')
        .eq('parent_id', diagnosis.winner.libraryTopicId)
      for (const sub of subtopics ?? []) {
        roadmapTopic = await findRoadmapTopicByLibraryTopic(admin, rule.roadmap_id, sub.id)
        if (roadmapTopic) break
      }
    }
  }
  if (!roadmapTopic) return { roadmapId: rule.roadmap_id, ruleId: rule.id, outcome: 'skipped_no_topic_link' }

  const initialStatus = rule.auto_confirm ? 'confirmed' : 'pending'
  const now = new Date()
  const expiresAt = new Date(now.getTime() + rule.confirm_timeout_hours * 60 * 60 * 1000)

  const { data: proposal, error } = await admin
    .from('homework_proposals')
    .insert({
      roadmap_id: rule.roadmap_id,
      rule_id: rule.id,
      organization_id: rule.organization_id,
      teacher_id: rule.roadmap_created_by,
      roadmap_topic_id: roadmapTopic.id,
      proposed_title: diagnosis.winner.topicName,
      proposed_summary: buildSummary(diagnosis.winner),
      rationale: JSON.parse(JSON.stringify(diagnosis.winner)),
      status: initialStatus,
      confirmed_at: rule.auto_confirm ? now.toISOString() : null,
      expires_at: expiresAt.toISOString(),
      slot_date: slotDate,
    })
    .select('id')
    .single()

  // Конфликт unique(roadmap_id, slot_date) — кто-то успел вставить между
  // нашим select-проверкой и insert (гонка двух cron-запусков). Не ошибка.
  if (error) {
    if (error.code === '23505') return { roadmapId: rule.roadmap_id, ruleId: rule.id, outcome: 'skipped_conflict' }
    throw new Error(`homework_proposals insert: ${error.message}`)
  }

  await notifyTeacher(admin, {
    proposalId: proposal.id,
    teacherId: rule.roadmap_created_by,
    orgId: rule.organization_id,
    roadmapTitle: rule.roadmap_title,
    winner: diagnosis.winner,
    autoConfirmed: rule.auto_confirm,
  })

  return { roadmapId: rule.roadmap_id, ruleId: rule.id, outcome: 'created', proposalId: proposal.id }
}

function buildSummary(winner: TopicCandidate): string {
  const parts: string[] = []
  if (winner.errorRatePct !== null && winner.wrongCount > 0) {
    parts.push(`${winner.wrongCount} ошиб${pluralOshibka(winner.wrongCount)} из ${winner.totalCount} (${winner.errorRatePct}%)`)
  }
  if (winner.isGap) parts.push('пройдено ранее по программе — пробел')
  if (winner.isCurrent) parts.push('текущая тема программы')
  return parts.join('; ') || 'недостаточно данных для точного диагноза, тема выбрана по программе'
}

async function notifyTeacher(
  admin: AdminClient,
  opts: {
    proposalId: string
    teacherId: string
    orgId: string
    roadmapTitle: string
    winner: TopicCandidate
    autoConfirmed: boolean
  }
): Promise<void> {
  const message = formatProposalMessage({
    roadmapTitle: opts.roadmapTitle,
    winner: opts.winner,
    autoConfirmed: opts.autoConfirmed,
  })
  await notifyUsers({
    admin,
    orgId: opts.orgId,
    eventType: 'homework_proposed',
    userIds: [opts.teacherId],
    recipient: 'teacher',
    message,
  })
}
