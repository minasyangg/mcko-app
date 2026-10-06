import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/supabase/auth-user'

// GET /api/assignments/[id]/stats — детали ОДНОГО назначения для иконки
// статистики в RoadmapEditor: когда создано, сроки, попытки и кто из
// адресатов (ученики группы/программы или один ученик) уже сдал задание.
// Лёгкий запрос на одно назначение, не весь прогресс программы
// (getRoadmapDetail нужен только полной панели ProgramDetailSheet).

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000
const SUBMITTED_STATUSES = ['submitted', 'under_review', 'checked']

type AttemptRow = {
  id: string; assignment_id: string; student_id: string; status: string
  score: number | null; max_score: number | null
  last_activity_at: string | null; started_at: string | null
}
type FinalRow = {
  assignment_id: string | null; student_id: string
  final_score: number | null; max_score: number | null
  attempt_count: number | null; closed_reason: string | null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await getAuthUser(supabase)
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()

  const { data: assignment } = await admin
    .from('assignments')
    .select(`
      id, organization_id, created_by, kind, max_attempts, created_at, starts_at, ends_at,
      group_id, student_id, test_version_id, roadmap_topic_id, closed_at,
      test_versions!test_version_id ( tests!test_id ( title, kind ) ),
      groups ( name ),
      profiles!student_id ( full_name )
    `)
    .eq('id', id)
    .single()

  if (!assignment || assignment.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Задание в теме программы видит владелец программы, даже если само
  // назначение создано не им (та же граница, что authorizeRoadmap)
  let roadmapTitle: string | null = null
  let topicTitle: string | null = null
  let roadmapOwner: string | null = null
  if (assignment.roadmap_topic_id) {
    const { data: topic } = await admin
      .from('roadmap_topics')
      .select('title, roadmaps!inner ( title, created_by )')
      .eq('id', assignment.roadmap_topic_id)
      .single()
    const roadmap = topic?.roadmaps as unknown as { title: string; created_by: string } | null
    topicTitle = topic?.title ?? null
    roadmapTitle = roadmap?.title ?? null
    roadmapOwner = roadmap?.created_by ?? null
  }
  if (profile.role !== 'admin' && assignment.created_by !== user.id && roadmapOwner !== user.id) {
    return NextResponse.json({ error: 'Статистика доступна создателю назначения, владельцу программы или администратору' }, { status: 403 })
  }

  const test = (assignment.test_versions as unknown as { tests: { title: string; kind: string } | null } | null)?.tests ?? null
  const groupName = (assignment.groups as unknown as { name: string } | null)?.name ?? null
  const studentName = (assignment.profiles as unknown as { full_name: string } | null)?.full_name ?? null

  // Адресаты: участники группы (у программы — её системная группа) или один ученик
  const members: { user_id: string; added_at: string | null }[] = assignment.group_id
    ? ((await admin.from('group_members').select('user_id, added_at').eq('group_id', assignment.group_id)).data ?? [])
    : assignment.student_id
      ? [{ user_id: assignment.student_id, added_at: null }]
      : []
  const studentIds = members.map(m => m.user_id)

  // Правило «3 дня» (миграция 058): вступивший в группу заметно позже
  // создания назначения его не видит — это не «не начал», а «не получал»
  const createdAtMs = assignment.created_at ? new Date(assignment.created_at).getTime() : null
  const lateJoinIds = new Set(
    assignment.group_id && createdAtMs != null
      ? members
          .filter(m => m.added_at && new Date(m.added_at).getTime() > createdAtMs + THREE_DAYS_MS)
          .map(m => m.user_id)
      : []
  )

  // «Открыть доступ» в программе заводит пропустившему ученику личную копию
  // этого же задания в той же теме — его прогресс тогда идёт по копии
  const personalCopyByStudent = new Map<string, { id: string; closed_at: string | null }>()
  if (lateJoinIds.size > 0 && assignment.roadmap_topic_id) {
    const { data: copies } = await admin
      .from('assignments')
      .select('id, student_id, closed_at')
      .eq('roadmap_topic_id', assignment.roadmap_topic_id)
      .eq('test_version_id', assignment.test_version_id)
      .in('student_id', [...lateJoinIds])
    for (const c of copies ?? []) {
      if (c.student_id) personalCopyByStudent.set(c.student_id, { id: c.id, closed_at: c.closed_at })
    }
  }
  const assignmentIds = [id, ...[...personalCopyByStudent.values()].map(c => c.id)]

  const [{ data: profiles }, { data: attemptsRaw }, { data: finals }] = studentIds.length
    ? await Promise.all([
        admin.from('profiles').select('id, full_name').in('id', studentIds),
        admin.from('attempts')
          .select('id, assignment_id, student_id, status, score, max_score, last_activity_at, started_at')
          .in('assignment_id', assignmentIds)
          .in('student_id', studentIds),
        admin.from('student_final_results')
          .select('assignment_id, student_id, final_score, max_score, attempt_count, closed_reason')
          .in('assignment_id', assignmentIds)
          .in('student_id', studentIds),
      ])
    : [{ data: [] as { id: string; full_name: string }[] }, { data: [] as AttemptRow[] }, { data: [] as FinalRow[] }]

  const nameById = new Map((profiles ?? []).map(p => [p.id, p.full_name]))

  // Последняя попытка на пару (назначение, ученик) — тот же приём, что
  // getRoadmapDetail (lib/roadmaps/progress.ts)
  const sortedByActivity = [...((attemptsRaw ?? []) as AttemptRow[])].sort(
    (a, b) => new Date(b.last_activity_at ?? b.started_at ?? 0).getTime() - new Date(a.last_activity_at ?? a.started_at ?? 0).getTime()
  )
  const latestByKey = new Map<string, AttemptRow>()
  const submittedCountByKey = new Map<string, number>()
  for (const a of sortedByActivity) {
    const key = `${a.assignment_id}_${a.student_id}`
    if (!latestByKey.has(key)) latestByKey.set(key, a)
    if (['submitted', 'checked'].includes(a.status)) {
      submittedCountByKey.set(key, (submittedCountByKey.get(key) ?? 0) + 1)
    }
  }
  const finalByKey = new Map(
    ((finals ?? []) as FinalRow[]).filter(f => f.assignment_id).map(f => [`${f.assignment_id}_${f.student_id}`, f])
  )

  const students = studentIds.map(sid => {
    const copy = personalCopyByStudent.get(sid) ?? null
    const lateJoin = lateJoinIds.has(sid)
    const receives = !lateJoin || !!copy
    const key = `${copy?.id ?? id}_${sid}`
    const latest = latestByKey.get(key)
    const fin = finalByKey.get(key)
    const closedAt = copy ? copy.closed_at : assignment.closed_at
    const attemptsUsed = receives ? Math.max(fin?.attempt_count ?? 0, submittedCountByKey.get(key) ?? 0) : 0
    const status = receives ? latest?.status ?? 'not_started' : 'not_started'
    return {
      id: sid,
      full_name: nameById.get(sid) ?? 'Ученик',
      /** false — ученик вступил в группу позже и задание ему не выдано */
      receives,
      personal_access: lateJoin && !!copy,
      status,
      submitted: receives && (attemptsUsed > 0 || SUBMITTED_STATUSES.includes(status)),
      score: receives ? fin?.final_score ?? latest?.score ?? null : null,
      max_score: receives ? fin?.max_score ?? latest?.max_score ?? null : null,
      attempts_used: attemptsUsed,
      closed_reason: !receives ? null : closedAt ? 'forced' : fin?.closed_reason ?? null,
    }
  }).sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru'))

  const target = roadmapTitle
    ? `Программа «${roadmapTitle}»${topicTitle ? `, тема «${topicTitle}»` : ''}`
    : groupName
      ? `Группа «${groupName}»`
      : studentName ?? '—'

  return NextResponse.json({
    id: assignment.id,
    title: test?.title ?? '—',
    // Тип, выбранный при назначении, важнее типа самого теста
    kind: (assignment.kind ?? test?.kind) === 'homework' ? 'homework' : 'test',
    target,
    created_at: assignment.created_at,
    starts_at: assignment.starts_at,
    ends_at: assignment.ends_at,
    max_attempts: assignment.max_attempts ?? 1,
    closed_at: assignment.closed_at,
    students,
  })
}
