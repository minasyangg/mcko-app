import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/authorize'

// Ручной запуск ежегодного перевода классов.
// Обычно перевод делает pg_cron 1 сентября (миграция 048) — этот роут нужен
// на случай, когда автозапуск не сработал или перевод надо провести раньше.
// Сама функция идемпотентна по учебному году: без force повторный вызов
// вернёт already_done и ничего не изменит.

const postSchema = z.object({
  force: z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  const auth = await requireAdmin('Переводить классы может только администратор')
  if ('error' in auth) return auth.error
  const { admin, userId } = auth

  const body = await request.json().catch(() => ({}))
  const parsed = postSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  }

  const { data, error } = await admin.rpc('promote_student_grades', {
    p_actor: userId,
    p_force: parsed.data.force ?? false,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // RPC с returns table отдаёт массив из одной строки
  const row = Array.isArray(data) ? data[0] : data
  return NextResponse.json({
    ok: true,
    promoted: row?.promoted ?? 0,
    graduated: row?.graduated ?? 0,
    skipped_already_done: row?.skipped_already_done ?? false,
  })
}

// GET — история переводов, чтобы админ видел, что перевод в этом году уже был
export async function GET() {
  const auth = await requireAdmin('Доступно только администратору')
  if ('error' in auth) return auth.error
  const { admin } = auth

  const { data, error } = await admin
    .from('grade_promotions')
    .select('school_year, promoted_count, graduated_count, ran_at, ran_by')
    .order('school_year', { ascending: false })
    .limit(20)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ promotions: data ?? [] })
}
