import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// PATCH — пользователь (любая роль) сохраняет свой ник Telegram и/или
// персональный переключатель уведомлений. Смена ника сбрасывает chat_id:
// новый владелец ника должен сам нажать /start у бота.
// Тело: { username?, notifications_enabled? } — оба поля опциональны.
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as
    { username?: string; notifications_enabled?: boolean } | null
  if (!body) return Response.json({ error: 'Invalid body' }, { status: 400 })

  const admin = createAdminClient()
  const update: {
    telegram_username?: string | null
    telegram_chat_id?: null
    notifications_enabled?: boolean
  } = {}
  let relinkRequired = false
  let normalizedUsername: string | null | undefined

  // ── Только переключатель уведомлений ──
  if (typeof body.notifications_enabled === 'boolean') {
    update.notifications_enabled = body.notifications_enabled
  }

  // ── Ник Telegram (если передан) ──
  if (body.username !== undefined) {
    const username = (body.username ?? '').trim().replace(/^@/, '')
    if (username && !/^[A-Za-z0-9_]{5,32}$/.test(username)) {
      return Response.json(
        { error: 'Ник Telegram — 5–32 символа: латиница, цифры, подчёркивание (без @)' },
        { status: 400 },
      )
    }
    const { data: current } = await admin
      .from('profiles').select('telegram_username').eq('id', user.id).single()
    const changed = (current?.telegram_username ?? '') !== username
    update.telegram_username = username || null
    normalizedUsername = username || null
    if (changed) { update.telegram_chat_id = null; relinkRequired = !!username }
  }

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'Нечего сохранять' }, { status: 400 })
  }

  const { error } = await admin.from('profiles').update(update).eq('id', user.id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({
    ok: true,
    username: normalizedUsername,
    relink_required: relinkRequired,
    notifications_enabled: update.notifications_enabled,
  })
}
