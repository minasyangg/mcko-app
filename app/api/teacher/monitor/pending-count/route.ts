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
    .select('student_id, assignment_id, status, last_activity_at')
    .in('status', ['submitted', 'under_review', 'checked'])
    .order('last_activity_at', { ascending: false })
    .limit(1000)

  // Keep only the latest attempt per group — same logic as MonitorTable
  const latestByGroup = new Map<string, string>()
  for (const a of attempts ?? []) {
    const key = `${a.student_id}:${a.assignment_id}`
    if (!latestByGroup.has(key)) latestByGroup.set(key, a.status)
  }

  // «checked» тоже считается «на проверке» — авто-проверка (в т.ч. ошибочная)
  // не должна проскакивать мимо учителя незамеченной, см. MonitorTable.
  const count = [...latestByGroup.values()]
    .filter(s => s === 'submitted' || s === 'under_review' || s === 'checked').length

  return Response.json({ count })
}
