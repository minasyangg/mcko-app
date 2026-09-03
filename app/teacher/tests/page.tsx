import { createClient } from '@/lib/supabase/server'
import { TestsListClient, type TestRow } from '@/components/teacher/TestsListClient'

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Мои задания</h1>
        <p className="text-sm text-muted-foreground mt-1">Тесты и домашние задания</p>
      </div>
      <TestsListClient rows={rows} isAdmin={isAdmin} teachers={teacherOptions} />
    </div>
  )
}
