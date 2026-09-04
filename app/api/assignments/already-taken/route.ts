import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'
import { createClient } from '@/lib/supabase/server'

const schema = z.object({
  test_id: zUuid(),
  student_id: zUuid().optional(),
  group_id: zUuid().optional(),
})

// POST /api/assignments/already-taken — «этот тест ученик уже проходил?»
//
// В отличие от дедупликации заданий (см. /api/assignments/duplicates), тут не
// нужно сопоставлять задачи: достаточно факта завершённой попытки по любой
// версии этого теста. Ответ информационный — назначить повторно можно.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { test_id, student_id, group_id } = parsed.data

  let students: string[] = student_id ? [student_id] : []
  if (group_id) {
    const { data: members } = await supabase
      .from('group_members').select('user_id').eq('group_id', group_id)
    students = [...new Set([...students, ...(members ?? []).map(m => m.user_id)])]
  }
  if (students.length === 0) return NextResponse.json({ taken: [] })

  // Все версии теста: ученик мог проходить старую редакцию
  const { data: versions } = await supabase
    .from('test_versions').select('id').eq('test_id', test_id)
  const versionIds = (versions ?? []).map(v => v.id)
  if (versionIds.length === 0) return NextResponse.json({ taken: [] })

  const { data: asgns } = await supabase
    .from('assignments').select('id').in('test_version_id', versionIds)
  const asgnIds = (asgns ?? []).map(a => a.id)
  if (asgnIds.length === 0) return NextResponse.json({ taken: [] })

  // Только доведённые до результата попытки: начатая и брошенная не считается
  // «уже проходил» — её как раз имеет смысл назначить снова.
  const { data: attempts, error } = await supabase
    .from('attempts')
    .select('student_id, score, max_score, submitted_at, status')
    .in('assignment_id', asgnIds)
    .in('student_id', students)
    .in('status', ['submitted', 'under_review', 'checked'])
    .order('submitted_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const seen = new Set<string>()
  const rows = (attempts ?? []).filter(a => {
    if (seen.has(a.student_id)) return false
    seen.add(a.student_id)
    return true
  })

  const nameById = new Map<string, string>()
  if (rows.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles').select('id, full_name').in('id', rows.map(r => r.student_id))
    for (const p of profiles ?? []) nameById.set(p.id, p.full_name ?? 'Ученик')
  }

  return NextResponse.json({
    taken: rows.map(a => ({
      student_id: a.student_id,
      student_name: nameById.get(a.student_id) ?? 'Ученик',
      score: a.score,
      max_score: a.max_score,
      submitted_at: a.submitted_at,
    })),
  })
}
