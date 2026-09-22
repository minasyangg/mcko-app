import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SharedWithMeTable, type SharedRow } from '@/components/teacher/SharedWithMeTable'

// «Расшарено мне» — сданные работы, которыми ученики поделились с этим
// учителем (assignment_shares, 087). RLS ("ashares: teacher reads own as
// recipient") сам ограничивает выборку тем, что реально расшарено —
// отдельный auth-фильтр в запросе не нужен, как и в остальных страницах
// раздела учителя.
//
// Только teacher: у admin эта страница вводила в заблуждение — RLS-политика
// "admin: read org" (давний инвариант проекта) даёт ему видеть ВСЕ активные
// гранты всей организации, а не только расшаренные лично ему, и страница с
// заголовком "Расшарено мне" читалась так, будто это именно его личные
// расшаривания. Решение пользователя (2026-09-21): у admin — не список, а
// плитка-счётчик на дашборде (см. app/teacher/page.tsx).
export default async function SharedWithMePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role === 'admin') redirect('/teacher')

  const { data: shares } = await supabase
    .from('assignment_shares')
    .select(`
      id, assignment_id, student_id, expires_at, created_at,
      profiles!student_id(full_name, grade),
      assignments!assignment_id(
        created_by,
        test_versions!test_version_id(
          tests!test_id(title, subject, exam_type)
        )
      )
    `)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(500)

  const senderIds = [...new Set(
    (shares ?? [])
      .map(s => (s.assignments as unknown as { created_by: string | null } | null)?.created_by)
      .filter((id): id is string => !!id)
  )]
  const assignmentIds = (shares ?? []).map(s => s.assignment_id)

  const [{ data: senders }, { data: finalResults }] = await Promise.all([
    senderIds.length > 0
      ? supabase.from('profiles').select('id, full_name').in('id', senderIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    assignmentIds.length > 0
      ? supabase
          .from('student_final_results')
          .select('assignment_id, student_id, final_score, max_score')
          .in('assignment_id', assignmentIds)
      : Promise.resolve({ data: [] as { assignment_id: string; student_id: string; final_score: number | null; max_score: number | null }[] }),
  ])

  const senderNameById = new Map((senders ?? []).map(t => [t.id, t.full_name]))
  // Ключ — (assignment_id, student_id), не просто assignment_id: для
  // группового назначения несколько учеников могут расшарить один и тот же
  // assignment_id, у каждого свой student_final_results — плоский Map по
  // одному assignment_id брал бы результат СЛУЧАЙНОГО (последнего в ответе
  // БД) студента для всех строк таблицы разом.
  const resultByKey = new Map(
    (finalResults ?? []).map(r => [`${r.assignment_id}_${r.student_id}`, r])
  )

  const rows: SharedRow[] = (shares ?? []).map(s => {
    const student = s.profiles as unknown as { full_name: string; grade: string | null } | null
    const assignment = s.assignments as unknown as {
      created_by: string | null
      test_versions: { tests: { title: string; subject: string | null; exam_type: string | null } | null } | null
    } | null
    const test = assignment?.test_versions?.tests
    const senderId = assignment?.created_by ?? null
    const result = resultByKey.get(`${s.assignment_id}_${s.student_id}`)

    return {
      share_id: s.id,
      assignment_id: s.assignment_id,
      student_id: s.student_id,
      student_name: student?.full_name ?? '—',
      grade: student?.grade ?? null,
      test_title: test?.title ?? '—',
      subject: test?.subject ?? null,
      exam_type: test?.exam_type ?? null,
      sender_name: senderId ? (senderNameById.get(senderId) ?? '—') : '—',
      score: result?.final_score ?? null,
      max_score: result?.max_score ?? null,
      expires_at: s.expires_at,
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Расшарено мне</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Сданные работы, которыми ученики поделились с вами — назначенные другими учителями.
        </p>
      </div>
      <SharedWithMeTable initialRows={rows} />
    </div>
  )
}
