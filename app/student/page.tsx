import { createClient } from '@/lib/supabase/server'
import { StudentHome, type AssignmentCardData, type RoadmapGroup } from '@/components/student/StudentHome'
import type { TimelineTopic } from '@/components/student/RoadmapTimeline'

type Search = { tab?: string }

// Главная страница кабинета ученика: ВСЁ назначенное в одном месте, вне
// зависимости от того, как оно попало к ученику — обычное назначение
// (лично или на группу) или задание учебной программы. Раньше это были два
// разных раздела («Мои тесты» и «Программа»), и назначение из программы не
// показывалось на первом экране вообще — ученик мог не заметить его, пока
// специально не зашёл в «Программа» (см. живой случай: Абрамян Варвара не
// видела, что ей назначено, пока не открыла нужный раздел).
export default async function StudentHomePage({ searchParams }: { searchParams: Promise<Search> }) {
  const { tab } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: memberships } = await supabase
    .from('group_members')
    .select('group_id, added_at')
    .eq('user_id', user.id)

  const groupIds = (memberships ?? []).map((m) => m.group_id as string)
  const joinedAtByGroup = new Map(
    (memberships ?? []).map((m) => [m.group_id as string, new Date(m.added_at as string).getTime()])
  )

  // Правило «вступил в группу больше чем на 3 дня позже назначения» — общее
  // для обычных и программных назначений, см. миграцию 058.
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000
  const notJoinedLate = (a: { group_id: string | null; created_at: string | null }) => {
    if (!a.group_id) return true
    const joinedAt = joinedAtByGroup.get(a.group_id)
    if (joinedAt == null) return true
    return joinedAt <= new Date(a.created_at ?? 0).getTime() + THREE_DAYS_MS
  }

  // ── Обычные назначения (лично или на группу, вне программ) ──
  let plainQuery = supabase
    .from('assignments')
    .select(`
      id, starts_at, ends_at, max_attempts, closed_at, created_at, group_id,
      groups ( name ),
      test_versions!test_version_id (
        id, time_limit_sec,
        tests!test_id ( id, title, subject, exam_type, is_active, kind )
      )
    `)

  plainQuery = groupIds.length > 0
    ? plainQuery.or(`student_id.eq.${user.id},group_id.in.(${groupIds.join(',')})`)
    : plainQuery.eq('student_id', user.id)
  plainQuery = plainQuery.is('roadmap_topic_id', null)

  const { data: rawPlain } = await plainQuery.order('created_at', { ascending: false })
  const plainAssignments = (rawPlain ?? []).filter((a) => {
    const tv = a.test_versions as any
    return tv?.tests?.is_active !== false && notJoinedLate(a)
  })

  // ── Программы ученика: roadmaps → topics → assignments(roadmap_topic_id) ──
  const { data: roadmaps } = groupIds.length
    ? await supabase.from('roadmaps')
        .select('id, title, subject, group_id')
        .in('group_id', groupIds)
        .order('subject')
        .order('title')
    : { data: [] as { id: string; title: string; subject: string | null; group_id: string | null }[] }

  const roadmapIds = (roadmaps ?? []).map(r => r.id)
  const roadmapById = new Map((roadmaps ?? []).map(r => [r.id, r]))

  const [{ data: topics }, { data: rawRoadmapItems }] = await Promise.all([
    roadmapIds.length
      ? supabase.from('roadmap_topics').select('id, roadmap_id, title, sort_order').in('roadmap_id', roadmapIds).order('sort_order')
      : Promise.resolve({ data: [] as { id: string; roadmap_id: string; title: string; sort_order: number }[] }),
    groupIds.length
      ? supabase.from('assignments')
          .select('id, roadmap_topic_id, kind, max_attempts, ends_at, closed_at, created_at, group_id, test_versions!test_version_id(tests!test_id(title, subject, exam_type, is_active))')
          .in('group_id', groupIds).not('roadmap_topic_id', 'is', null)
      : Promise.resolve({ data: [] as never[] }),
  ])

  const topicById = new Map((topics ?? []).map(t => [t.id, t]))
  const roadmapItems = (rawRoadmapItems ?? []).filter(a => {
    const tv = a.test_versions as { tests?: { is_active?: boolean } } | null
    return tv?.tests?.is_active !== false && notJoinedLate(a)
  })

  // ── Попытки + накопительные итоги — одним запросом на ВСЕ назначения (и
  // обычные, и программные), а не двумя отдельными как раньше ──
  const allAssignmentIds = [
    ...plainAssignments.map(a => a.id),
    ...roadmapItems.map(a => a.id),
  ]
  const [{ data: attempts }, { data: finals }] = allAssignmentIds.length > 0
    ? await Promise.all([
        supabase
          .from('attempts')
          .select('id, assignment_id, status, score, max_score')
          .in('assignment_id', allAssignmentIds)
          .eq('student_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('student_final_results')
          .select('assignment_id, final_score, max_score, attempt_count, closed_reason')
          .in('assignment_id', allAssignmentIds)
          .eq('student_id', user.id),
      ])
    : [{ data: [] }, { data: [] }]

  type AttemptRow = { id: string; assignment_id: string | null; status: string; score: number | null; max_score: number | null }
  const attemptMap = new Map<string, AttemptRow>()
  const usedByAssignment = new Map<string, number>()
  for (const a of (attempts ?? []) as AttemptRow[]) {
    if (!a.assignment_id) continue
    if (!attemptMap.has(a.assignment_id)) attemptMap.set(a.assignment_id, a)
    if (['submitted', 'checked'].includes(a.status)) {
      usedByAssignment.set(a.assignment_id, (usedByAssignment.get(a.assignment_id) ?? 0) + 1)
    }
  }

  type FinalRow = { assignment_id: string | null; final_score: number | null; max_score: number | null; attempt_count: number | null; closed_reason: string | null }
  const finalMap = new Map<string, FinalRow>()
  for (const f of (finals ?? []) as FinalRow[]) {
    if (f.assignment_id) finalMap.set(f.assignment_id, f)
  }

  // ── Собираем единые карточки для табов «Всё» / «Тесты» / «ДЗ» ──
  const cards: AssignmentCardData[] = []

  for (const a of plainAssignments) {
    const tv = a.test_versions as any
    const test = tv?.tests as any
    const attempt = attemptMap.get(a.id)
    const fin = finalMap.get(a.id)
    const status = (attempt?.status as AssignmentCardData['status']) ?? 'not_started'
    const attemptsUsed = Math.max(fin?.attempt_count ?? 0, usedByAssignment.get(a.id) ?? 0)
    const closedReason = (a.closed_at ? 'forced' : null) ?? fin?.closed_reason ?? null
    const group = a.groups as any

    cards.push({
      assignment_id: a.id,
      test_title: test?.title ?? 'Тест',
      subject: test?.subject ?? null,
      exam_type: test?.exam_type ?? null,
      kind: test?.kind === 'homework' ? 'homework' : 'test',
      // Персональное назначение и назначение без группы (не должно
      // случаться, но на всякий) источник не показывают — незачем.
      source: group?.name ? `Группа «${group.name}»` : null,
      time_limit_sec: tv?.time_limit_sec ?? null,
      status,
      score: fin?.final_score ?? attempt?.score ?? null,
      max_score: fin?.max_score ?? attempt?.max_score ?? null,
      attempts_used: attemptsUsed,
      max_attempts: a.max_attempts ?? 1,
      ends_at: a.ends_at,
      closed_reason: closedReason,
    })
  }

  for (const a of roadmapItems) {
    const tv = a.test_versions as any
    const test = tv?.tests as any
    const attempt = attemptMap.get(a.id)
    const fin = finalMap.get(a.id)
    const status = (attempt?.status as AssignmentCardData['status']) ?? 'not_started'
    const attemptsUsed = Math.max(fin?.attempt_count ?? 0, usedByAssignment.get(a.id) ?? 0)
    const closedReason = fin?.closed_reason ?? (a.closed_at ? 'forced' : null)
    const topic = topicById.get(a.roadmap_topic_id as string)
    const roadmap = topic ? roadmapById.get(topic.roadmap_id) : null

    cards.push({
      assignment_id: a.id,
      test_title: test?.title ?? 'Тест',
      subject: test?.subject ?? null,
      exam_type: test?.exam_type ?? null,
      kind: (a.kind as 'homework' | 'test') ?? 'test',
      source: `Программа «${roadmap?.title ?? 'без названия'}»${topic ? ` → ${topic.title}` : ''}`,
      time_limit_sec: null,
      status,
      score: fin?.final_score ?? attempt?.score ?? null,
      max_score: fin?.max_score ?? attempt?.max_score ?? null,
      attempts_used: attemptsUsed,
      max_attempts: a.max_attempts ?? 1,
      ends_at: a.ends_at,
      closed_reason: closedReason,
    })
  }

  cards.sort((a, b) => {
    // Активные и непроверенные — выше уже закрытых, внутри группы порядок
    // по сроку (у кого он есть) не считаем: сортировка по дате создания
    // назначения потерялась бы при слиянии двух источников без лишнего
    // джойна, а видимого смысла «когда именно назначено» в карточке нет.
    const rank = (c: AssignmentCardData) => c.closed_reason != null ? 2 : c.status === 'checked' ? 1 : 0
    return rank(a) - rank(b)
  })

  // ── Для вкладки «Программа»: те же roadmapItems, сгруппированные по темам ──
  const itemsByTopic = new Map<string, TimelineTopic['items']>()
  for (const a of roadmapItems) {
    const tid = a.roadmap_topic_id as string
    const tv = a.test_versions as { tests?: { title?: string } } | null
    const attempt = attemptMap.get(a.id)
    const fin = finalMap.get(a.id)
    const arr = itemsByTopic.get(tid) ?? []
    arr.push({
      assignment_id: a.id,
      test_title: tv?.tests?.title ?? 'Тест',
      kind: (a.kind as 'homework' | 'test') ?? 'test',
      status: attempt?.status ?? 'not_started',
      score: fin?.final_score ?? attempt?.score ?? null,
      max_score: fin?.max_score ?? attempt?.max_score ?? null,
      attempts_used: Math.max(fin?.attempt_count ?? 0, usedByAssignment.get(a.id) ?? 0),
      max_attempts: a.max_attempts ?? 1,
      ends_at: a.ends_at,
      closed_reason: fin?.closed_reason ?? (a.closed_at ? 'forced' : null),
    })
    itemsByTopic.set(tid, arr)
  }

  const topicsByRoadmap = new Map<string, TimelineTopic[]>()
  for (const t of topics ?? []) {
    const its = itemsByTopic.get(t.id) ?? []
    const state: TimelineTopic['state'] = its.length > 0 && its.every(i => i.status === 'checked')
      ? 'done'
      : its.some(i => ['in_progress', 'submitted', 'checked'].includes(i.status))
        ? 'active'
        : 'pending'
    const arr = topicsByRoadmap.get(t.roadmap_id) ?? []
    arr.push({ id: t.id, title: t.title, state, items: its })
    topicsByRoadmap.set(t.roadmap_id, arr)
  }

  const roadmapGroups: RoadmapGroup[] = (roadmaps ?? []).map(r => ({
    id: r.id,
    title: r.title,
    subject: r.subject,
    topics: topicsByRoadmap.get(r.id) ?? [],
  }))

  const initialTab = tab === 'test' || tab === 'homework' || tab === 'roadmap' ? tab : 'all'

  return <StudentHome assignments={cards} roadmaps={roadmapGroups} initialTab={initialTab} />
}
