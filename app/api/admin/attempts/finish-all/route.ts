import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { finalizeAttempt } from '@/lib/grading/finalize'

// POST /api/admin/attempts/finish-all — принудительно завершить ВСЕ активные
// попытки организации, даже если время не истекло и попытки не израсходованы.
// Только admin. in_progress → финализируются (авто-проверка + итог);
// not_started (ученик не приступал) → помечаются expired, чтобы не висели.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin' || !profile.organization_id) {
    return NextResponse.json({ error: 'Доступно только администратору' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Активные попытки организации (через assignment.organization_id)
  const { data: active } = await admin
    .from('attempts')
    .select('id, status, assignments!inner(organization_id)')
    .in('status', ['in_progress', 'not_started'])
    .eq('assignments.organization_id', profile.organization_id)

  const rows = active ?? []
  const inProgress = rows.filter(a => a.status === 'in_progress')
  const notStarted = rows.filter(a => a.status === 'not_started')

  // Финализируем начатые (последовательно — внутри AI-запросы, бережём лимиты)
  let finished = 0
  for (const a of inProgress) {
    const res = await finalizeAttempt(a.id, { admin })
    if (res) finished++
  }

  // Не начатые — помечаем истёкшими
  let expired = 0
  if (notStarted.length > 0) {
    const now = new Date().toISOString()
    const { error } = await admin
      .from('attempts')
      .update({ status: 'expired', last_activity_at: now })
      .in('id', notStarted.map(a => a.id))
    if (!error) expired = notStarted.length
  }

  return NextResponse.json({ ok: true, finished, expired })
}
