import { createClient } from '@/lib/supabase/server'

// GET /api/teacher/proposals — список предложений ДЗ от агента автосборки
// (project_homework_agent) для вкладки «Предложения» в «Мои задания».
// RLS ("homework_proposals: teacher manage own", 082) уже отдаёт только
// свои — фильтр по teacher_id не нужен явно.
//
// Опрашивается с фронта через usePolling (lib/hooks/usePolling) — тот же
// приём, что и остальные живые списки/счётчики в проекте (Supabase Realtime
// не работает, publication supabase_realtime пуста, см. память
// feedback_realtime_badges).
export async function GET() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ proposals: [] }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ proposals: [] }, { status: 403 })
  }

  const { data: proposals } = await supabase
    .from('homework_proposals')
    .select('id, roadmap_id, status, proposed_title, final_title, proposed_summary, expires_at, created_at, updated_at, test_id, assignment_id, roadmaps!roadmap_id(title)')
    .order('created_at', { ascending: false })
    .limit(50)

  // Число заданий собранного ДЗ — одним запросом на все тесты сразу
  // (правило проекта: не запрос на строку списка).
  const testIds = (proposals ?? []).map(p => p.test_id).filter((id): id is string => !!id)
  const taskCountByTest = new Map<string, number>()
  if (testIds.length > 0) {
    const { data: taskRows } = await supabase
      .from('test_tasks')
      .select('id, test_versions!inner(test_id)')
      .in('test_versions.test_id', testIds)
    for (const t of taskRows ?? []) {
      const testId = (t.test_versions as unknown as { test_id: string } | null)?.test_id
      if (testId) taskCountByTest.set(testId, (taskCountByTest.get(testId) ?? 0) + 1)
    }
  }

  const rows = (proposals ?? []).map(p => ({
    id: p.id,
    roadmap_id: p.roadmap_id,
    roadmap_title: (p.roadmaps as unknown as { title: string } | null)?.title ?? '—',
    status: p.status,
    title: p.final_title ?? p.proposed_title,
    proposed_summary: p.proposed_summary,
    expires_at: p.expires_at,
    created_at: p.created_at,
    built_at: p.updated_at,
    test_id: p.test_id,
    assignment_id: p.assignment_id,
    task_count: p.test_id ? taskCountByTest.get(p.test_id) ?? null : null,
  }))

  return Response.json({ proposals: rows })
}
