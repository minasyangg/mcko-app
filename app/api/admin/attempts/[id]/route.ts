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

  // Попытка считается «потраченной»: НЕ уменьшаем attempt_count в итоге —
  // сохраняем «сколько попыток было использовано». Обновляем только балл
  // итога до результата ПОСЛЕДНЕЙ оставшейся завершённой попытки; если
  // завершённых не осталось — оставляем прежний итог (последний известный).
  const now = new Date().toISOString()
  const { data: latest } = await admin
    .from('attempts')
    .select('score, max_score, submitted_at, checked_at')
    .eq('assignment_id', attempt.assignment_id)
    .eq('student_id', attempt.student_id)
    .in('status', ['submitted', 'checked'])
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest) {
    await admin.from('student_final_results')
      .update({ final_score: latest.score, max_score: latest.max_score, updated_at: now })
      .eq('student_id', attempt.student_id)
      .eq('test_version_id', asgn.test_version_id)
  }
  // запись student_final_results НЕ удаляем — «использовано N из M» и
  // последний результат остаются даже без строк attempts.

  const [{ data: sfr }, { data: assignment }] = await Promise.all([
    admin.from('student_final_results')
      .select('attempt_count, final_score, max_score')
      .eq('student_id', attempt.student_id)
      .eq('test_version_id', asgn.test_version_id)
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
