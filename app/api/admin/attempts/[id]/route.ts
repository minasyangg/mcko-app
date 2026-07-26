import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/authorize'
import { updateCumulativeResult } from '@/lib/grading/finalize'

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

  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { admin, orgId } = auth

  // Попытка + организация (через assignment) — не даём удалять чужую орг
  const { data: attempt } = await admin
    .from('attempts')
    .select('id, student_id, assignment_id, assignments!inner(organization_id)')
    .eq('id', attemptId)
    .single()
  if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })

  const asgn = attempt.assignments as unknown as { organization_id: string }
  if (asgn.organization_id !== orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // solution_requests → attempts БЕЗ каскада: чистим вручную
  await admin.from('solution_requests').delete().eq('attempt_id', attemptId)

  const { error: delErr } = await admin.from('attempts').delete().eq('id', attemptId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  // Пересчёт итога — общей функцией, а не своей формулой: раньше здесь
  // записывался балл ПОСЛЕДНЕЙ оставшейся попытки, что противоречит
  // накопительной семантике (MAX по каждому заданию среди всех попыток) во
  // всех остальных путях — удаление попытки могло срезать ученику балл,
  // честно заработанный в другой попытке.
  // Попытка при этом считается потраченной: attempt_count не уменьшаем.
  await updateCumulativeResult(admin, attempt.assignment_id, attempt.student_id, {
    preserveAttemptCount: true,
  })
  // запись student_final_results НЕ удаляем — «использовано N из M» и
  // последний результат остаются даже без строк attempts.

  const [{ data: sfr }, { data: assignment }] = await Promise.all([
    admin.from('student_final_results')
      .select('attempt_count, final_score, max_score')
      .eq('student_id', attempt.student_id)
      .eq('assignment_id', attempt.assignment_id)
      .maybeSingle(),
    admin.from('assignments').select('max_attempts').eq('id', attempt.assignment_id).single(),
  ])

  return NextResponse.json({
    ok: true,
    attempts_used: sfr?.attempt_count ?? 0,
    max_attempts: assignment?.max_attempts ?? 1,
    last_score: sfr?.final_score ?? null,
    last_max: sfr?.max_score ?? null,
  })
}
