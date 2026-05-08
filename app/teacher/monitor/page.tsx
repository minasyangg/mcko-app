import { createClient } from '@/lib/supabase/server'
import { MonitorTable, type AttemptRow } from '@/components/teacher/MonitorTable'

export default async function MonitorPage() {
  const supabase = await createClient()

  const { data: attempts } = await supabase
    .from('attempts')
    .select(`
      id, status, current_task_number, score, max_score,
      last_activity_at, started_at, submitted_at, student_id,
      assignment_id,
      assignments!inner (
        id,
        test_version_id,
        test_versions!test_version_id (
          tests!test_id ( title )
        )
      ),
      profiles ( full_name, grade )
    `)
    .in('status', ['not_started', 'in_progress', 'submitted', 'under_review', 'checked'])
    .order('last_activity_at', { ascending: false })
    .limit(200)

  // Compute attempt number: count previous attempts for same student+assignment
  const allAttemptsList = attempts ?? []
  // Group by (student_id, assignment_id), sort by started_at to get order
  const attemptCountMap = new Map<string, number>()
  // Process in chronological order
  const sorted = [...allAttemptsList].sort(
    (a, b) => new Date(a.started_at ?? 0).getTime() - new Date(b.started_at ?? 0).getTime()
  )
  const attemptNumberMap = new Map<string, number>()
  for (const a of sorted) {
    const key = `${a.student_id}_${(a as any).assignment_id}`
    const n = (attemptCountMap.get(key) ?? 0) + 1
    attemptCountMap.set(key, n)
    attemptNumberMap.set(a.id, n)
  }

  const rows: AttemptRow[] = allAttemptsList.map((a) => {
    const asgn = a.assignments as any
    const tv = asgn?.test_versions as any
    const test = tv?.tests as any
    const profile = a.profiles as any
    return {
      id: a.id,
      student_id: a.student_id,
      status: a.status,
      current_task_number: a.current_task_number,
      score: a.score,
      max_score: a.max_score,
      last_activity_at: a.last_activity_at,
      started_at: a.started_at,
      submitted_at: a.submitted_at,
      full_name: profile?.full_name ?? '—',
      grade: profile?.grade ?? null,
      test_title: test?.title ?? '—',
      attempt_number: attemptNumberMap.get(a.id) ?? 1,
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Мониторинг</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Попытки учеников в реальном времени
        </p>
      </div>
      <MonitorTable initialAttempts={rows} />
    </div>
  )
}
