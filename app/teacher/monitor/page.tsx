import { createClient } from '@/lib/supabase/server'
import { MonitorTable, type AttemptRow } from '@/components/teacher/MonitorTable'

export default async function MonitorPage() {
  const supabase = await createClient()

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

  // Load cumulative scores from student_final_results
  const { data: finalResults } = await supabase
    .from('student_final_results')
    .select('student_id, test_version_id, final_score, max_score, attempt_count, status')

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
    const totalAttempts = attemptCountMap.get(groupKey) ?? 1
    const latestAttemptNum = attemptNumberMap.get(a.id) ?? totalAttempts
    const maxAttempts = asgn?.max_attempts ?? 1
    const allUsed = totalAttempts >= maxAttempts && !['in_progress', 'not_started'].includes(a.status)

    // Get cumulative score from student_final_results
    const finalKey = `${a.student_id}_${asgn?.test_version_id}`
    const final = finalMap.get(finalKey)

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Мониторинг</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Текущий статус по каждому назначенному тесту
        </p>
      </div>
      <MonitorTable initialAttempts={rows} />
    </div>
  )
}
