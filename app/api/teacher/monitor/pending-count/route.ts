import { createClient } from '@/lib/supabase/server'

// Returns count of (student, assignment) groups where the LATEST attempt needs review.
// Matches exactly what the "На проверке" tab shows in MonitorTable.
export async function GET() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ count: 0 }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ count: 0 }, { status: 403 })
  }

  // Load all non-active attempts ordered newest first.
  // We only need the latest per (student_id, assignment_id) to determine current state.
  const { data: attempts } = await supabase
    .from('attempts')
    .select('student_id, assignment_id, status, last_activity_at, teacher_reviewed_at')
    .in('status', ['submitted', 'under_review', 'checked'])
    .order('last_activity_at', { ascending: false })
    .limit(1000)

  // Keep only the latest attempt per group — same logic as MonitorTable
  const latestByGroup = new Map<string, { status: string; reviewed: boolean }>()
  for (const a of attempts ?? []) {
    const key = `${a.student_id}:${a.assignment_id}`
    if (!latestByGroup.has(key)) latestByGroup.set(key, { status: a.status, reviewed: a.teacher_reviewed_at != null })
  }

  // «checked» тоже считается «на проверке» — авто-проверка (в т.ч. ошибочная)
  // не должна проскакивать мимо учителя незамеченной, см. MonitorTable. НО
  // если учитель уже проверил работу вручную (teacher_reviewed_at, миграция
  // 057) или назначение закрыто (попытки исчерпаны/полный балл/решение
  // учителя — closed_reason в student_final_results), пересматривать нечего:
  // такие пары исключаем, иначе бейдж навсегда завышен на уже разобранные
  // работы (см. правку статусов в MonitorTable/monitor/page.tsx — тот же баг).
  const assignmentIds = [...new Set([...latestByGroup.keys()].map(k => k.split(':')[1]))]
  const studentIds = [...new Set([...latestByGroup.keys()].map(k => k.split(':')[0]))]
  const { data: finalResults } = assignmentIds.length
    ? await supabase
        .from('student_final_results')
        .select('student_id, assignment_id, closed_reason')
        .in('assignment_id', assignmentIds)
        .in('student_id', studentIds)
        .not('closed_reason', 'is', null)
    : { data: [] as { student_id: string; assignment_id: string | null; closed_reason: string | null }[] }
  const closedSet = new Set((finalResults ?? []).map(r => `${r.student_id}:${r.assignment_id}`))

  const count = [...latestByGroup.entries()]
    .filter(([key, v]) =>
      (v.status === 'submitted' || v.status === 'under_review' || v.status === 'checked') &&
      !v.reviewed && !closedSet.has(key))
    .length

  return Response.json({ count })
}
