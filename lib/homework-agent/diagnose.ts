import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

// Веса скоринга — константы в коде, не в БД: учитель правит РЕЗУЛЬТАТ
// диагноза (тему, состав ДЗ), а не тонкую настройку алгоритма — см. решение
// в плане project_homework_agent, раздел «Скоринг».
//
// WEIGHT_EXAM_UNCOVERED специально мал (тай-брейкер, не полноценный сигнал):
// при равном весе с ошибками тема без единой реальной ошибки, но не
// покрытая банком заданий, обгоняла тему с явной, многократно подтверждённой
// проблемой — диагностика ошибок не должна уступать первенство «мы ещё
// не давали этих задач». D решает только между темами с близким err_pct.
const WEIGHT_ERROR_RATE = 3.0
const WEIGHT_IS_GAP = 2.0
const WEIGHT_IS_CURRENT = 1.5
const WEIGHT_EXAM_UNCOVERED = 0.1
const WEIGHT_ASSIGNED_RECENTLY = -2.0

// Тема с меньшим числом реальных ошибок не годится в диагноз ошибок вовсе —
// иначе единичная случайная помарка (wrong=1) конкурирует с темой, где
// ошибалось действительно много учеников, только за счёт вспомогательных
// сигналов (B/D). Порог ниже, чем having в diagnose_roadmap_mistakes (там
// total>=3 — достаточно выборки), потому что здесь отсекаются именно
// bezошибочные/почти безошибочные темы, не темы с малой выборкой попыток.
const MIN_WRONG_FOR_DIAGNOSIS = 3

// Доверие к err_pct растёт с размером выборки: тема «2 из 6» (33%) не должна
// обгонять тему «7 из 22» (32%) только по чистому проценту — 22 попытки
// статистически надёжнее 6. При total>=CONFIDENCE_FULL_AT доверие полное
// (1.0), меньше — линейно снижается, приглушая шумный процент малой выборки.
const CONFIDENCE_FULL_AT = 10

export interface TopicCandidate {
  libraryTopicId: string
  topicName: string
  fipiCode: string | null
  /** Сигнал A: доля ошибок по теме за lookback-окно, 0..100. Null — тема не встречалась в попытках. */
  errorRatePct: number | null
  wrongCount: number
  totalCount: number
  /** Сигнал B: тема совпадает с fgos_curriculum той roadmap_topics, что помечена status='current'. */
  isCurrent: boolean
  /** Сигнал B: тема относится к разделу ФГОС, пройденному раньше текущей темы программы (по sort_order) — «пробел». */
  isGap: boolean
  /** Сигнал D: тема входит в разрешённый экзаменационный источник правила и слабо покрыта прошлыми назначениями. */
  examUncoveredScore: number
  /** Сигнал: тема уже была основой ДЗ в последние 14 дней — понижает приоритет повтора той же темы подряд. */
  assignedRecently: boolean
  score: number
}

export interface DiagnosisResult {
  candidates: TopicCandidate[]
  /** Победитель — первый по score, либо null если диагноз пуст (нет данных для программы). */
  winner: TopicCandidate | null
  currentRoadmapTopicId: string | null
}

interface RoadmapMistakeRow {
  library_topic_id: string
  topic_name: string
  fipi_code: string | null
  fgos_grade: string | null
  wrong: number
  total: number
  err_pct: number
}

/**
 * Комплексная диагностика темы для очередного ДЗ программы — сигналы
 * A (ошибки), B (позиция во ФГОС: пробел/текущая/впереди), D (недопокрытые
 * темы экзамена). Сигнал C (прогресс, два среза) не входит сюда — он для
 * отдельного отчёта учителю, не для выбора темы ДЗ.
 *
 * Не читает roadmap_agent_rules сама — вызывающая сторона (propose.ts)
 * передаёт lookbackDays и examSources из уже загруженного правила, чтобы
 * diagnose.ts оставался чистой функцией без побочного чтения конфигурации.
 */
export async function diagnoseRoadmap(
  admin: AdminClient,
  opts: {
    roadmapId: string
    teacherId: string
    lookbackDays: number
    /** exam_type+subject из roadmap_agent_rule_sources с source_kind='library_exam', если правило их разрешает. */
    examSources: { examType: string; subject: string }[]
  }
): Promise<DiagnosisResult> {
  const [mistakesRes, topicsRes] = await Promise.all([
    admin.rpc('diagnose_roadmap_mistakes', {
      p_roadmap_id: opts.roadmapId,
      p_lookback_days: opts.lookbackDays,
    }),
    admin
      .from('roadmap_topics')
      .select('id, sort_order, status, fgos_curriculum_id, library_topic_id')
      .eq('roadmap_id', opts.roadmapId)
      .order('sort_order'),
  ])

  if (mistakesRes.error) throw new Error(`diagnose_roadmap_mistakes: ${mistakesRes.error.message}`)
  const mistakeRows = (mistakesRes.data ?? []) as RoadmapMistakeRow[]
  const topics = topicsRes.data ?? []

  const currentTopic = topics.find(t => t.status === 'current') ?? null
  const currentSortOrder = currentTopic?.sort_order ?? null

  // «Пробел»: темы roadmap_topics с меньшим sort_order, чем текущая, и
  // связанной library_topic_id — то, что программа уже прошла формально
  // (по порядку), но кодификатор-тема которой относится к диагнозу.
  const pastTopicIds = new Set(
    topics
      .filter(t => currentSortOrder !== null && t.sort_order < currentSortOrder && t.library_topic_id)
      .map(t => t.library_topic_id as string)
  )
  const currentTopicLibraryId = currentTopic?.library_topic_id ?? null

  // Сигнал D: сколько задач по каждой разрешённой экзаменационной теме уже
  // покрыто прошлыми назначениями этого учителя (через assigned_problems,
  // 052) — чем меньше покрытие, тем выше приоритет темы.
  const examTopicCoverage = await loadExamTopicCoverage(admin, opts.teacherId, opts.examSources)

  // Темы, которые были основой ДЗ (roadmap_topic_id последнего
  // homework_proposals.status='built') за последние 14 дней — не повторяем
  // ту же тему сразу следующим ДЗ подряд.
  const recentTopicIds = await loadRecentlyAssignedTopics(admin, opts.roadmapId)

  const candidates: TopicCandidate[] = mistakeRows.map(row => {
    const isGap = pastTopicIds.has(row.library_topic_id)
    const isCurrent = row.library_topic_id === currentTopicLibraryId
    const examUncoveredScore = examTopicCoverage.get(row.library_topic_id) ?? 0
    const assignedRecently = recentTopicIds.has(row.library_topic_id)

    const confidence = Math.min(row.total / CONFIDENCE_FULL_AT, 1)
    const errorRateNorm = (row.err_pct / 100) * confidence
    // D — тай-брейкер: даёт голос только темам, где уже есть реальные
    // ошибки (>= MIN_WRONG_FOR_DIAGNOSIS), иначе «мы ещё не давали этих
    // задач» могло бы вытащить безошибочную тему в победители сама по себе.
    const examUncoveredContribution = row.wrong >= MIN_WRONG_FOR_DIAGNOSIS ? examUncoveredScore : 0
    const score =
      WEIGHT_ERROR_RATE * errorRateNorm +
      WEIGHT_IS_GAP * (isGap ? 1 : 0) +
      WEIGHT_IS_CURRENT * (isCurrent ? 1 : 0) +
      WEIGHT_EXAM_UNCOVERED * examUncoveredContribution +
      WEIGHT_ASSIGNED_RECENTLY * (assignedRecently ? 1 : 0)

    return {
      libraryTopicId: row.library_topic_id,
      topicName: row.topic_name,
      fipiCode: row.fipi_code,
      errorRatePct: row.err_pct,
      wrongCount: row.wrong,
      totalCount: row.total,
      isCurrent,
      isGap,
      examUncoveredScore,
      assignedRecently,
      score,
    }
  })

  candidates.sort((a, b) => b.score - a.score)

  return {
    candidates,
    winner: candidates[0] ?? null,
    currentRoadmapTopicId: currentTopic?.id ?? null,
  }
}

/**
 * Сигнал D: доля недопокрытых тем экзаменационного банка (0..1 на тему) —
 * 1.0 значит тема ещё ни разу не встречалась в прошлых назначениях этого
 * учителя, 0.0 значит она уже хорошо отработана (>=3 разных задач по теме
 * были в ДЗ). Возвращает пусто, если правило не разрешает ни один
 * library_exam источник (тогда D не влияет на скоринг).
 *
 * assigned_problems.problem_id (052) — id КОНКРЕТНОЙ ЗАДАЧИ
 * (book_problem_id/library_problem_id), не темы; вью не отдаёт тему
 * напрямую. Поэтому здесь два шага: сначала problem_id из вью, затем
 * отдельным запросом к library_problems — их canonical_topic_id/topic_id.
 */
async function loadExamTopicCoverage(
  admin: AdminClient,
  teacherId: string,
  examSources: { examType: string; subject: string }[]
): Promise<Map<string, number>> {
  if (examSources.length === 0) return new Map()

  // Все темы разрешённых экзаменационных источников — знаменатель для 0.0
  // (полностью покрыта) и дефолт 1.0 (не встречалась вовсе) для остальных.
  const allTopicIds = new Set<string>()
  for (const src of examSources) {
    const { data: topics } = await admin
      .from('library_topics')
      .select('id')
      .eq('exam_type', src.examType)
      .eq('subject', src.subject)
    for (const t of topics ?? []) allTopicIds.add(t.id)
  }
  if (allTopicIds.size === 0) return new Map()

  // Что этот учитель уже задавал (все source_kind сразу — вью не различает
  // предмет/экзамен, фильтруем ниже по факту принадлежности задачи теме).
  const { data: assigned } = await admin
    .from('assigned_problems')
    .select('library_problem_id')
    .eq('teacher_id', teacherId)
    .not('library_problem_id', 'is', null)

  const assignedProblemIds = [...new Set((assigned ?? []).map(a => a.library_problem_id).filter((id): id is string => id !== null))]

  const topicHitCounts = new Map<string, number>()
  if (assignedProblemIds.length > 0) {
    const { data: problems } = await admin
      .from('library_problems')
      .select('canonical_topic_id, topic_id')
      .in('id', assignedProblemIds)
    for (const p of problems ?? []) {
      const topicId = p.canonical_topic_id ?? p.topic_id
      if (!topicId || !allTopicIds.has(topicId)) continue
      topicHitCounts.set(topicId, (topicHitCounts.get(topicId) ?? 0) + 1)
    }
  }

  const FULLY_COVERED_AT = 3 // >=3 разных заданий по теме в прошлых ДЗ — считаем «хорошо отработана»
  const coverage = new Map<string, number>()
  for (const topicId of allTopicIds) {
    const hits = topicHitCounts.get(topicId) ?? 0
    coverage.set(topicId, Math.max(0, 1 - hits / FULLY_COVERED_AT))
  }
  return coverage
}

/**
 * Темы, которые были финальной (после правки учителя) темой построенного
 * (status='built') предложения ДЗ этой программы за последние 14 дней —
 * понижают приоритет повторного выбора той же темы подряд.
 */
async function loadRecentlyAssignedTopics(admin: AdminClient, roadmapId: string): Promise<Set<string>> {
  const { data } = await admin
    .from('homework_proposals')
    .select('roadmap_topic_id')
    .eq('roadmap_id', roadmapId)
    .eq('status', 'built')
    .gte('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())

  const ids = new Set<string>()
  for (const row of data ?? []) {
    if (row.roadmap_topic_id) ids.add(row.roadmap_topic_id)
  }
  return ids
}
