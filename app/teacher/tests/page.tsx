import { createClient } from '@/lib/supabase/server'
import { TestsListClient, type TestRow } from '@/components/teacher/TestsListClient'
import type { ProposalRow } from '@/components/teacher/ProposalsListClient'

export default async function TestsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from('profiles').select('role').eq('id', user.id).single()
    : { data: null }
  const isAdmin = profile?.role === 'admin'

  // RLS: учитель видит только свои тесты, админ — все тесты организации.
  const { data: tests } = await supabase
    .from('tests')
    .select('id, title, subject, grade, exam_type, status, is_active, created_at, kind, created_by')
    .order('created_at', { ascending: false })

  // Для админа резолвим авторов (тесты могут быть разных учителей) и собираем
  // список учителей для фильтра
  const ownerName = new Map<string, string>()
  let teacherOptions: { id: string; full_name: string }[] = []
  if (isAdmin) {
    const ids = [...new Set((tests ?? []).map(t => t.created_by).filter(Boolean))] as string[]
    if (ids.length) {
      const { data: owners } = await supabase.from('profiles').select('id, full_name').in('id', ids)
      for (const o of owners ?? []) ownerName.set(o.id, o.full_name)
    }
    teacherOptions = [...ownerName.entries()]
      .map(([id, full_name]) => ({ id, full_name }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru'))
  }

  const rows: TestRow[] = (tests ?? []).map(t => ({
    id: t.id,
    title: t.title,
    subject: t.subject,
    grade: t.grade,
    exam_type: t.exam_type,
    status: t.status,
    is_active: t.is_active,
    created_at: t.created_at,
    kind: t.kind,
    owner_id: t.created_by ?? null,
    owner_name: isAdmin ? (t.created_by ? ownerName.get(t.created_by) ?? '—' : '—') : null,
  }))

  // Предложения ДЗ от агента автосборки — только у учителя (у него есть
  // свои roadmap; админ — read-only «кабинет», не подтверждает предложения).
  let proposals: ProposalRow[] = []
  if (!isAdmin) {
    const { data: proposalRows } = await supabase
      .from('homework_proposals')
      .select('id, roadmap_id, status, proposed_title, final_title, proposed_summary, expires_at, created_at, updated_at, test_id, assignment_id, roadmaps!roadmap_id(title)')
      .order('created_at', { ascending: false })
      .limit(50)

    // Число заданий собранного ДЗ — для подписи «8 заданий» в карточке.
    // Одним запросом на все тесты сразу, не по запросу на карточку.
    const testIds = (proposalRows ?? []).map(p => p.test_id).filter((id): id is string => !!id)
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

    proposals = (proposalRows ?? []).map(p => ({
      id: p.id,
      roadmap_id: p.roadmap_id,
      roadmap_title: (p.roadmaps as unknown as { title: string } | null)?.title ?? '—',
      status: p.status as ProposalRow['status'],
      title: p.final_title ?? p.proposed_title,
      proposed_summary: p.proposed_summary,
      expires_at: p.expires_at,
      created_at: p.created_at,
      built_at: p.updated_at,
      test_id: p.test_id,
      assignment_id: p.assignment_id,
      task_count: p.test_id ? taskCountByTest.get(p.test_id) ?? null : null,
    }))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Мои задания</h1>
        <p className="text-sm text-muted-foreground mt-1">Тесты и домашние задания</p>
      </div>
      <TestsListClient rows={rows} isAdmin={isAdmin} teachers={teacherOptions} proposals={proposals} />
    </div>
  )
}
