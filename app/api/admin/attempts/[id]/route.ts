import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// DELETE /api/admin/attempts/[id] — удалить попытку ученика. Только admin.
// Каскадом удаляются ответы (attempt_task_answers) и события присутствия
// (presence_events); solution_requests (без каскада) удаляются вручную.
// Накопительный итог (student_final_results) пересчитывается по оставшимся
// завершённым попыткам.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: attemptId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin' || !profile.organization_id) {
    return NextResponse.json({ error: 'Доступно только администратору' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Попытка + организация (через assignment) — не даём удалять чужую орг
  const { data: attempt } = await admin
    .from('attempts')
    .select('id, student_id, assignment_id, assignments!inner(organization_id, test_version_id)')
    .eq('id', attemptId)
    .single()
  if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })

  const asgn = attempt.assignments as unknown as { organization_id: string; test_version_id: string }
  if (asgn.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // solution_requests → attempts БЕЗ каскада: чистим вручную
  await admin.from('solution_requests').delete().eq('attempt_id', attemptId)

  const { error: delErr } = await admin.from('attempts').delete().eq('id', attemptId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  // Пересчёт накопительного итога по оставшимся завершённым попыткам
  const { data: remaining } = await admin
    .from('attempts')
    .select('id, max_score')
    .eq('assignment_id', attempt.assignment_id)
    .eq('student_id', attempt.student_id)
    .in('status', ['submitted', 'checked'])

  const ids = (remaining ?? []).map(a => a.id)
  if (ids.length === 0) {
    // Больше нет завершённых попыток — убираем итог
    await admin.from('student_final_results').delete()
      .eq('student_id', attempt.student_id)
      .eq('test_version_id', asgn.test_version_id)
  } else {
    const { data: answers } = await admin
      .from('attempt_task_answers')
      .select('task_id, awarded_score')
      .in('attempt_id', ids)
    const taskBest = new Map<string, number>()
    for (const ans of answers ?? []) {
      if (!ans.task_id) continue
      taskBest.set(ans.task_id, Math.max(taskBest.get(ans.task_id) ?? 0, ans.awarded_score ?? 0))
    }
    const cumulative = [...taskBest.values()].reduce((s, v) => s + v, 0)
    const maxScore = Math.max(...(remaining ?? []).map(a => a.max_score ?? 0), 0)

    const { data: assignment } = await admin
      .from('assignments').select('max_attempts').eq('id', attempt.assignment_id).single()
    const allUsed = ids.length >= (assignment?.max_attempts ?? 1)

    await admin.from('student_final_results').upsert({
      student_id: attempt.student_id,
      test_version_id: asgn.test_version_id,
      final_score: cumulative,
      max_score: maxScore,
      attempt_count: ids.length,
      status: allUsed ? 'completed' : 'in_progress',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'student_id,test_version_id' })
  }

  return NextResponse.json({ ok: true })
}
