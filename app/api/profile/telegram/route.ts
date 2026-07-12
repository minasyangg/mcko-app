import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// PATCH — пользователь (любая роль) сохраняет свой ник Telegram.
// Смена ника сбрасывает привязку chat_id: новый владелец ника должен сам
// нажать /start у бота, иначе уведомления ушли бы на старый чат.
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as { username?: string } | null
  if (!body) return Response.json({ error: 'Invalid body' }, { status: 400 })

  // нормализация: без @, пустая строка = отвязать
  const username = (body.username ?? '').trim().replace(/^@/, '')
  if (username && !/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    return Response.json(
      { error: 'Ник Telegram — 5–32 символа: латиница, цифры, подчёркивание (без @)' },
      { status: 400 },
    )
  }

  const admin = createAdminClient()
  const { data: current } = await admin
    .from('profiles').select('telegram_username').eq('id', user.id).single()

  const changed = (current?.telegram_username ?? '') !== username
  const { error } = await admin
    .from('profiles')
    .update({
      telegram_username: username || null,
      ...(changed ? { telegram_chat_id: null } : {}),
    })
    .eq('id', user.id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true, username: username || null, relink_required: changed && !!username })
}
