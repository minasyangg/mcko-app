import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

// ── Сводка программ (лёгкий запрос — для строк списка) ──────────────────────
// RLS сам разграничивает: teacher видит свои roadmaps, admin — все по
// организации (`roadmaps: admin read org`). Owner-имена резолвятся только
// когда вызывающий — admin (см. `resolveOwners`), учителю они не нужны.

export interface ProgramSummaryRow {
  id: string
  title: string
  subject: string | null
  owner_id: string
  owner_name: string | null
  topic_count: number
  student_count: number
  completion_pct: number | null // null — нет ни заданий, ни учеников
}

export async function getRoadmapSummaries(
  supabase: Client,
  opts: { resolveOwners?: boolean } = {}
): Promise<ProgramSummaryRow[]> {
  const { data: roadmaps } = await supabase
    .from('roadmaps')
    .select('id, title, subject, group_id, created_by')
    .order('created_at', { ascending: false })

  const rows = roadmaps ?? []
  if (rows.length === 0) return []

  const roadmapIds = rows.map(r => r.id)
  const groupIds = [...new Set(rows.map(r => r.group_id).filter(Boolean))] as string[]

  const [{ data: topics }, { data: members }, ownersRes] = await Promise.all([
    supabase.from('roadmap_topics').select('id, roadmap_id').in('roadmap_id', roadmapIds),
    groupIds.length
      ? supabase.from('group_members').select('group_id, user_id').in('group_id', groupIds)
      : Promise.resolve({ data: [] as { group_id: string; user_id: string }[] }),
    opts.resolveOwners
      ? supabase.from('profiles').select('id, full_name').in('id', [...new Set(rows.map(r => r.created_by))])
      : Promise.resolve({ data: null as { id: string; full_name: string }[] | null }),
  ])

  const topicCount = new Map<string, number>()
  for (const t of topics ?? []) topicCount.set(t.roadmap_id, (topicCount.get(t.roadmap_id) ?? 0) + 1)

  const studentsByGroup = new Map<string, string[]>()
  for (const m of members ?? []) {
    const arr = studentsByGroup.get(m.group_id) ?? []
    arr.push(m.user_id)
    studentsByGroup.set(m.group_id, arr)
  }

  const ownerName = new Map<string, string>()
  for (const o of ownersRes.data ?? []) ownerName.set(o.id, o.full_name)

  // Грубая % выполнения для строки списка: доля (ученик×задание), где есть
  // проверенная попытка. Полная детализация (кто именно, какой балл) —
  // отдельным запросом getRoadmapDetail по клику, не здесь.
  const { data: itemRows } = groupIds.length
    ? await supabase
        .from('assignments')
        .select('id, group_id')
        .in('group_id', groupIds)
        .not('roadmap_topic_id', 'is', null)
    : { data: [] as { id: string; group_id: string | null }[] }

  const itemsByGroup = new Map<string, string[]>()
  for (const a of itemRows ?? []) {
    if (!a.group_id) continue
    const arr = itemsByGroup.get(a.group_id) ?? []
    arr.push(a.id)
    itemsByGroup.set(a.group_id, arr)
  }

  const allAssignmentIds = (itemRows ?? []).map(a => a.id)
  const { data: checkedAttempts } = allAssignmentIds.length
    ? await supabase
        .from('attempts')
        .select('assignment_id, student_id')
        .eq('status', 'checked')
        .in('assignment_id', allAssignmentIds)
    : { data: [] as { assignment_id: string; student_id: string }[] }
  const checkedSet = new Set((checkedAttempts ?? []).map(a => `${a.assignment_id}_${a.student_id}`))

  return rows.map(r => {
    const students = r.group_id ? (studentsByGroup.get(r.group_id) ?? []) : []
    const items = r.group_id ? (itemsByGroup.get(r.group_id) ?? []) : []
    const slots = students.length * items.length
    let done = 0
    if (slots > 0) {
      for (const sid of students) for (const aid of items) if (checkedSet.has(`${aid}_${sid}`)) done++
    }
    return {
      id: r.id,
      title: r.title,
      subject: r.subject,
      owner_id: r.created_by,
      owner_name: ownerName.get(r.created_by) ?? null,
      topic_count: topicCount.get(r.id) ?? 0,
      student_count: students.length,
      completion_pct: slots > 0 ? Math.round((done / slots) * 100) : null,
    }
  })
}

// ── Полная детализация ОДНОЙ программы (тяжёлый запрос — по клику) ──────────

export interface ProgramItemStatus {
  assignment_id: string
  student_id: string
  status: string // not_started|in_progress|submitted|under_review|checked|expired
  score: number | null
  max_score: number | null
  attempt_id: string | null
  attempts_used: number
  max_attempts: number
}

export interface ProgramTopicItem {
  assignment_id: string
  title: string
  kind: string
  max_attempts: number
  ends_at: string | null
  test_version_id: string
}

export interface ProgramTopic {
  id: string
  title: string
  sort_order: number
  items: ProgramTopicItem[]
}

export interface ProgramDetail {
  id: string
  title: string
  subject: string | null
  students: { id: string; full_name: string }[]
  topics: ProgramTopic[]
  statuses: ProgramItemStatus[]
}

export async function getRoadmapDetail(supabase: Client, roadmapId: string): Promise<ProgramDetail | null> {
  const { data: roadmap } = await supabase
    .from('roadmaps')
    .select('id, title, subject, group_id')
    .eq('id', roadmapId)
    .single()
  if (!roadmap) return null

  const { data: topics } = await supabase
    .from('roadmap_topics')
    .select('id, title, sort_order')
    .eq('roadmap_id', roadmapId)
    .order('sort_order', { ascending: true })

  const topicIds = (topics ?? []).map(t => t.id)

  const { data: assignmentRows } = topicIds.length
    ? await supabase
        .from('assignments')
        .select(`
          id, roadmap_topic_id, kind, max_attempts, ends_at, test_version_id,
          test_versions!test_version_id ( tests!test_id ( title, kind ) )
        `)
        .in('roadmap_topic_id', topicIds)
    : { data: [] as {
        id: string; roadmap_topic_id: string | null; kind: string | null
        max_attempts: number | null; ends_at: string | null; test_version_id: string
        test_versions: { tests: { title: string; kind: string } | null } | null
      }[] }

  const { data: members } = roadmap.group_id
    ? await supabase.from('group_members').select('user_id').eq('group_id', roadmap.group_id)
    : { data: [] as { user_id: string }[] }
  const studentIds = (members ?? []).map(m => m.user_id)

  const { data: profiles } = studentIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', studentIds)
    : { data: [] as { id: string; full_name: string }[] }

  const assignmentIds = (assignmentRows ?? []).map(a => a.id)
  const testVersionIds = [...new Set((assignmentRows ?? []).map(a => a.test_version_id))]

  const [{ data: attemptsRaw }, { data: sfr }] = await Promise.all([
    assignmentIds.length
      ? supabase.from('attempts')
          .select('id, assignment_id, student_id, status, score, max_score, last_activity_at, started_at')
          .in('assignment_id', assignmentIds)
      : Promise.resolve({ data: [] as {
          id: string; assignment_id: string; student_id: string; status: string
          score: number | null; max_score: number | null
          last_activity_at: string | null; started_at: string | null
        }[] }),
    (testVersionIds.length && studentIds.length)
      ? supabase.from('student_final_results')
          .select('student_id, test_version_id, final_score, max_score, attempt_count')
          .in('test_version_id', testVersionIds)
          .in('student_id', studentIds)
      : Promise.resolve({ data: [] as {
          student_id: string; test_version_id: string
          final_score: number | null; max_score: number | null; attempt_count: number | null
        }[] }),
  ])

  // Последняя попытка на пару (assignment_id, student_id) — тот же паттерн,
  // что в app/teacher/monitor/page.tsx (сортировка по активности, первый на ключ)
  const sortedByActivity = [...(attemptsRaw ?? [])].sort(
    (a, b) => new Date(b.last_activity_at ?? b.started_at ?? 0).getTime() - new Date(a.last_activity_at ?? a.started_at ?? 0).getTime()
  )
  const latestByKey = new Map<string, typeof sortedByActivity[number]>()
  for (const a of sortedByActivity) {
    const key = `${a.assignment_id}_${a.student_id}`
    if (!latestByKey.has(key)) latestByKey.set(key, a)
  }

  // Фолбэк для attempts_used, если student_final_results ещё нет строки
  const liveCountByKey = new Map<string, number>()
  for (const a of attemptsRaw ?? []) {
    if (!['submitted', 'checked'].includes(a.status)) continue
    const key = `${a.assignment_id}_${a.student_id}`
    liveCountByKey.set(key, (liveCountByKey.get(key) ?? 0) + 1)
  }

  const sfrByKey = new Map<string, { final_score: number | null; max_score: number | null; attempt_count: number | null }>()
  for (const r of sfr ?? []) sfrByKey.set(`${r.student_id}_${r.test_version_id}`, r)

  const statuses: ProgramItemStatus[] = []
  for (const a of assignmentRows ?? []) {
    for (const sid of studentIds) {
      const key = `${a.id}_${sid}`
      const latest = latestByKey.get(key)
      const sfrRow = sfrByKey.get(`${sid}_${a.test_version_id}`)
      statuses.push({
        assignment_id: a.id,
        student_id: sid,
        status: latest?.status ?? 'not_started',
        score: sfrRow?.final_score ?? latest?.score ?? null,
        max_score: sfrRow?.max_score ?? latest?.max_score ?? null,
        attempt_id: latest?.id ?? null,
        attempts_used: sfrRow?.attempt_count ?? liveCountByKey.get(key) ?? 0,
        max_attempts: a.max_attempts ?? 1,
      })
    }
  }

  const itemsByTopic = new Map<string, ProgramTopicItem[]>()
  for (const a of assignmentRows ?? []) {
    const tid = a.roadmap_topic_id
    if (!tid) continue
    const arr = itemsByTopic.get(tid) ?? []
    arr.push({
      assignment_id: a.id,
      title: a.test_versions?.tests?.title ?? 'Тест',
      kind: a.kind ?? a.test_versions?.tests?.kind ?? 'test',
      max_attempts: a.max_attempts ?? 1,
      ends_at: a.ends_at,
      test_version_id: a.test_version_id,
    })
    itemsByTopic.set(tid, arr)
  }

  return {
    id: roadmap.id,
    title: roadmap.title,
    subject: roadmap.subject,
    students: (profiles ?? []).map(p => ({ id: p.id, full_name: p.full_name })),
    topics: (topics ?? []).map(t => ({ id: t.id, title: t.title, sort_order: t.sort_order, items: itemsByTopic.get(t.id) ?? [] })),
    statuses,
  }
}
