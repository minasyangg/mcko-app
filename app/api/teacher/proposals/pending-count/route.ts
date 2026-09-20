import { createClient } from '@/lib/supabase/server'

// Бейдж «Предложения агента» в TeacherNav — чтобы новое предложение ДЗ
// (project_homework_agent) не потерялось, пока учитель не заглянул в
// раздел (тот же принцип, что moderationBadge/monitorBadge, см. память
// feedback_realtime_badges).
export async function GET() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ count: 0 }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ count: 0 }, { status: 403 })
  }

  // RLS отдаёт только свои — точный count без явного teacher_id-фильтра.
  const { count } = await supabase
    .from('homework_proposals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')

  return Response.json({ count: count ?? 0 })
}
