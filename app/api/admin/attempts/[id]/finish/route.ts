import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/authorize'
import { finalizeAttempt } from '@/lib/grading/finalize'

// POST /api/admin/attempts/[id]/finish — принудительно завершить ОДНУ попытку
// (тот же механизм, что «завершить все»): in_progress → финализация
// (авто-проверка + итог), not_started → expired. Только admin.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: attemptId } = await params

  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { admin, orgId } = auth

  const { data: attempt } = await admin
    .from('attempts')
    .select('id, status, assignments!inner(organization_id)')
    .eq('id', attemptId)
    .single()
  if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })

  const asgn = attempt.assignments as unknown as { organization_id: string }
  if (asgn.organization_id !== orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (attempt.status === 'in_progress') {
    const res = await finalizeAttempt(attemptId, { admin })
    if (!res) return NextResponse.json({ error: 'Не удалось завершить попытку' }, { status: 500 })
    return NextResponse.json({ ok: true, status: res.status, score: res.score, max_score: res.max_score })
  }

  if (attempt.status === 'not_started') {
    const { error } = await admin
      .from('attempts')
      .update({ status: 'expired', last_activity_at: new Date().toISOString() })
      .eq('id', attemptId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, status: 'expired' })
  }

  return NextResponse.json({ error: 'Попытка уже завершена' }, { status: 409 })
}
