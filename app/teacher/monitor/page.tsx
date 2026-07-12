import { createClient } from '@/lib/supabase/server'
import { MonitorTable, type AttemptRow } from '@/components/teacher/MonitorTable'
import type { AssignmentRow } from '@/components/teacher/AssignmentsPanel'

export default async function MonitorPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from('profiles').select('role').eq('id', user.id).single()
    : { data: null }
  const isAdmin = profile?.role === 'admin'

  // Load all recent attempts with assignment/student info
  const { data: attempts } = await supabase
    .from('attempts')
    .select(`
      id, status, current_task_number, score, max_score,
      last_activity_at, started_at, submitted_at, student_id,
      assignment_id,
      assignments!inner (
        id,
        max_attempts,
        test_version_id,
        test_versions!test_version_id (
          tests!test_id ( title )
        )
      ),
      profiles ( full_name, grade )
    `)
    .in('status', ['not_started', 'in_progress', 'submitted', 'under_review', 'checked'])
    .order('last_activity_at', { ascending: false })
    .limit(500)

  // Итоги — только по версиям/ученикам из загруженных попыток,
  // а не вся таблица организации
  const tvIds = [...new Set((attempts ?? []).map(a => (a as any).assignments?.test_version_id).filter(Boolean))]
  const studentIds = [...new Set((attempts ?? []).map(a => a.student_id))]
  const { data: finalResults } = tvIds.length
    ? await supabase
        .from('student_final_results')
        .select('student_id, test_version_id, final_score, max_score, attempt_count, status')
        .in('test_version_id', tvIds)
        .in('student_id', studentIds)
    : { data: [] as { student_id: string; test_version_id: string; final_score: number | null; max_score: number | null; attempt_count: number | null; status: string | null }[] }

  // Map: "studentId_tvId" → final result
  const finalMap = new Map(
    (finalResults ?? []).map(r => [`${r.student_id}_${r.test_version_id}`, r])
  )

  // Group attempts by (student_id, assignment_id) — keep one row per assignment
  // Use the LATEST attempt per group (by last_activity_at)
  const groupMap = new Map<string, typeof attempts extends (infer T)[] | null ? T : never>()
  const attemptCountMap = new Map<string, number>()
  const attemptNumberMap = new Map<string, number>()

  // Sort chronologically to compute attempt numbers
  const allAttempts = [...(attempts ?? [])].sort(
    (a, b) => new Date(a.started_at ?? 0).getTime() - new Date(b.started_at ?? 0).getTime()
  )

  for (const a of allAttempts) {
    const groupKey = `${a.student_id}_${(a as any).assignment_id}`
    const n = (attemptCountMap.get(groupKey) ?? 0) + 1
    attemptCountMap.set(groupKey, n)
    attemptNumberMap.set(a.id, n)
  }

  // Sort by last_activity_at descending for latest-per-group selection
  const sortedByActivity = [...(attempts ?? [])].sort(
    (a, b) => new Date(b.last_activity_at ?? 0).getTime() - new Date(a.last_activity_at ?? 0).getTime()
  )

  for (const a of sortedByActivity) {
    const groupKey = `${a.student_id}_${(a as any).assignment_id}`
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, a)
    }
  }

  const rows: AttemptRow[] = [...groupMap.values()].map((a) => {
    const asgn = (a as any).assignments
    const tv = asgn?.test_versions
    const test = tv?.tests
    const profile = (a as any).profiles
    const groupKey = `${a.student_id}_${(a as any).assignment_id}`
    const liveTotal = attemptCountMap.get(groupKey) ?? 1
    const latestAttemptNum = attemptNumberMap.get(a.id) ?? liveTotal
    const maxAttempts = asgn?.max_attempts ?? 1

    // Get last-attempt result + used count from student_final_results.
    // attempt_count переживает удаление отдельной попытки («потрачено N из M»).
    const finalKey = `${a.student_id}_${asgn?.test_version_id}`
    const final = finalMap.get(finalKey)
    const totalAttempts = final?.attempt_count ?? liveTotal
    const allUsed = totalAttempts >= maxAttempts && !['in_progress', 'not_started'].includes(a.status)

    return {
      id: a.id,
      student_id: a.student_id,
      status: allUsed && a.status === 'checked' ? 'completed' : a.status,
      current_task_number: a.current_task_number,
      score: final?.final_score ?? a.score,
      max_score: final?.max_score ?? a.max_score,
      last_activity_at: a.last_activity_at,
      started_at: a.started_at,
      submitted_at: a.submitted_at,
      full_name: profile?.full_name ?? '—',
      grade: profile?.grade ?? null,
      test_title: test?.title ?? '—',
      attempt_number: latestAttemptNum,
      total_attempts: totalAttempts,
      max_attempts: maxAttempts,
    }
  }).sort((a, b) => new Date(b.last_activity_at ?? 0).getTime() - new Date(a.last_activity_at ?? 0).getTime())

  // ── Таб «Назначения» (перенесён из /teacher/assignments) ──
  // Roadmap-назначения (roadmap_topic_id) не показываем: программа — не
  // группа, её заданиями управляет редактор программы.
  const { data: asgnRows } = await supabase
    .from('assignments')
    .select(`
      id, starts_at, ends_at, max_attempts, created_at,
      group_id, student_id, test_version_id,
      test_versions!test_version_id ( tests!test_id ( title ) ),
      groups ( name ),
      profiles!student_id ( full_name ),
      attempts ( id, status, student_id )
    `)
    .is('roadmap_topic_id', null)
    .order('created_at', { ascending: false })
    .limit(100)

  const asgnTvIds = [...new Set((asgnRows ?? []).map(a => a.test_version_id).filter(Boolean))]
  const { data: asgnFinals } = asgnTvIds.length
    ? await supabase
        .from('student_final_results')
        .select('student_id, test_version_id, final_score, max_score, attempt_count')
        .in('test_version_id', asgnTvIds)
    : { data: [] as { student_id: string; test_version_id: string; final_score: number | null; max_score: number | null; attempt_count: number | null }[] }
  const asgnFinalMap = new Map(
    (asgnFinals ?? []).map(r => [`${r.student_id}_${r.test_version_id}`, r])
  )

  const assignments: AssignmentRow[] = (asgnRows ?? []).map(a => {
    const tv = a.test_versions as any
    const test = tv?.tests as any
    const group = a.groups as any
    const profileRow = (a as any).profiles as any
    const allAttempts = ((a as any).attempts ?? []) as { status: string }[]
    const maxAttempts = a.max_attempts ?? 1
    const isGroup = !!a.group_id
    const sfr = !isGroup && a.student_id ? asgnFinalMap.get(`${a.student_id}_${a.test_version_id}`) : undefined
    const liveCompleted = allAttempts.filter(at => ['submitted', 'checked'].includes(at.status)).length
    const completedCount = isGroup ? 0 : (sfr?.attempt_count ?? liveCompleted)
    return {
      id: a.id,
      test_title: test?.title ?? '—',
      target: group?.name ? `Группа: ${group.name}` : profileRow?.full_name ?? (a.student_id ? 'Ученик' : '—'),
      starts_at: a.starts_at,
      ends_at: a.ends_at,
      created_at: a.created_at,
      is_group: isGroup,
      max_attempts: maxAttempts,
      completed_count: completedCount,
      is_completed: !isGroup && completedCount >= maxAttempts && completedCount > 0,
      last_result: sfr && sfr.final_score != null ? `${sfr.final_score}/${sfr.max_score ?? '?'}` : null,
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Мониторинг</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Назначения тестов и текущий статус попыток
        </p>
      </div>
      <MonitorTable initialAttempts={rows} isAdmin={isAdmin} assignments={assignments} />
    </div>
  )
}
