import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { zUuid } from '@/lib/uuid'

// Приращения счётчиков поведения по заданиям попытки — признаки списывания
// (миграция 118, клиент — components/test-player/useIntegritySignals.ts).
// Владение попыткой, её статус и принадлежность заданий тесту проверяет сама
// add_attempt_task_signals: она пишет только в незавершённую попытку этого
// ученика, поэтому здесь — один запрос без предварительного чтения попытки.

const count = z.number().int().min(0)
const schema = z.object({
  rows: z.array(z.object({
    task_id: zUuid(),
    active_ms: count.optional(),
    away_count: count.optional(),
    away_ms: count.optional(),
    paste_count: count.optional(),
    pasted_chars: count.optional(),
    typed_inputs: count.optional(),
    away_paste_count: count.optional(),
    blind_paste_count: count.optional(),
  })).min(1).max(200),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: attemptId } = await params
  const supabase = await createClient()
  const { data: { user } } = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || !zUuid().safeParse(attemptId).success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { error } = await createAdminClient().rpc('add_attempt_task_signals', {
    p_attempt_id: attemptId,
    p_student_id: user.id,
    p_rows: parsed.data.rows,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
