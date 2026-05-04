import { createClient } from '@/lib/supabase/server'
import { MonitorTable, type AttemptRow } from '@/components/teacher/MonitorTable'

export default async function MonitorPage() {
  const supabase = await createClient()

  const { data: attempts } = await supabase
    .from('attempts')
    .select(`
      id, status, current_task_number, score, max_score,
      last_activity_at, started_at, submitted_at, student_id,
      assignments!inner (
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

  const rows: AttemptRow[] = (attempts ?? []).map((a) => {
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
