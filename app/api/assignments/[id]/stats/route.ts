import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/supabase/auth-user'

// GET /api/assignments/[id]/stats — детали ОДНОГО назначения для иконки
// статистики в RoadmapEditor (кто уже решил из назначенных учеников группы/
// одиночно, сколько попыток, когда создано/дедлайн). Лёгкий эндпоинт на одно
// назначение — не тащит весь прогресс программы (getRoadmapDetail), который
// нужен только для полной страницы ProgramDetailSheet.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await getAuthUser(supabase)
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()

  const { data: assignment } = await admin
    .from('assignments')
    .select(`
      id, organization_id, created_by, kind, max_attempts, created_at, starts_at, ends_at,
      group_id, student_id, test_version_id, closed_at,
      test_versions!test_version_id ( tests!test_id ( title, kind ) )
    `)
    .eq('id', id)
    .single()

  if (!assignment || assignment.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  // Owner-чек — тот же, что в DELETE этого же назначения
  if (profile.role !== 'admin' && assignment.created_by !== user.id) {
    return NextResponse.json({ error: 'Доступна только для создателя назначения или администратора' }, { status: 403 })
  }

  const tv = assignment.test_versions as unknown as { tests: { title: string; kind: string } | null } | null
  const test = tv?.tests ?? null

  // Ученики, которым реально адресовано назначение: группа — все её участники,
  // одиночное — один ученик.
  const studentIds = assignment.group_id
    ? ((await admin.from('group_members').select('user_id').eq('group_id', assignment.group_id)).data ?? []).map(m => m.user_id)
    : assignment.student_id
      ? [assignment.student_id]
      : []

  const { data: profiles } = studentIds.length
    ? await admin.from('profiles').select('id, full_name').in('id', studentIds)
    : { data: [] as { id: string; full_name: string }[] }
  const nameById = new Map((profiles ?? []).map(p => [p.id, p.full_name]))

  const [{ data: attemptsRaw }, { data: sfr }] = await Promise.all([
    studentIds.length
      ? admin.from('attempts')
          .select('id, student_id, status, score, max_score, last_activity_at, started_at')
          .eq('assignment_id', id)
          .in('student_id', studentIds)
      : Promise.resolve({ data: [] as {
          id: string; student_id: string; status: string
          score: number | null; max_score: number | null
          last_activity_at: string | null; started_at: string | null
        }[] }),
    studentIds.length
      ? admin.from('student_final_results')
          .select('student_id, final_score, max_score, attempt_count, closed_reason')
          .eq('assignment_id', id)
          .in('student_id', studentIds)
      : Promise.resolve({ data: [] as {
          student_id: string; final_score: number | null; max_score: number | null
          attempt_count: number | null; closed_reason: string | null
        }[] }),
  ])

  // Последняя попытка на ученика — тот же паттерн, что в
  // lib/roadmaps/progress.ts/getRoadmapDetail (сортировка по активности,
  // первый встреченный на ключ).
  const sortedByActivity = [...(attemptsRaw ?? [])].sort(
    (a, b) => new Date(b.last_activity_at ?? b.started_at ?? 0).getTime() - new Date(a.last_activity_at ?? a.started_at ?? 0).getTime()
  )
  const latestByStudent = new Map<string, typeof sortedByActivity[number]>()
  for (const a of sortedByActivity) {
    if (!latestByStudent.has(a.student_id)) latestByStudent.set(a.student_id, a)
  }
  const liveCountByStudent = new Map<string, number>()
  for (const a of attemptsRaw ?? []) {
    if (!['submitted', 'checked'].includes(a.status)) continue
    liveCountByStudent.set(a.student_id, (liveCountByStudent.get(a.student_id) ?? 0) + 1)
  }
  const sfrByStudent = new Map((sfr ?? []).map(r => [r.student_id, r]))

  const students = studentIds.map(sid => {
    const latest = latestByStudent.get(sid)
    const sfrRow = sfrByStudent.get(sid)
    return {
      id: sid,
      full_name: nameById.get(sid) ?? 'Ученик',
      status: latest?.status ?? 'not_started',
      score: sfrRow?.final_score ?? latest?.score ?? null,
      max_score: sfrRow?.max_score ?? latest?.max_score ?? null,
      attempt_id: latest?.id ?? null,
      attempts_used: Math.max(sfrRow?.attempt_count ?? 0, liveCountByStudent.get(sid) ?? 0),
      closed_reason: assignment.closed_at ? 'forced' : sfrRow?.closed_reason ?? null,
    }
  })

  return NextResponse.json({
    id: assignment.id,
    title: test?.title ?? '—',
    kind: (test?.kind ?? assignment.kind) === 'homework' ? 'homework' : 'test',
    created_at: assignment.created_at,
    starts_at: assignment.starts_at,
    ends_at: assignment.ends_at,
    max_attempts: assignment.max_attempts ?? 1,
    is_group: !!assignment.group_id,
    students,
  })
}
