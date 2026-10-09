import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { findTelegramNickHolder } from '@/lib/notifications/telegram-username'

// POST /api/auth/telegram-available — свободен ли ник Telegram, для формы
// саморегистрации до signUp. Публичный: заявитель ещё не вошёл, поэтому
// отвечаем только да/нет, без имени владельца. Занятый ник почти всегда
// значит, что у человека уже есть аккаунт (живой случай 2026-10-10: второй
// аккаунт ученицы перехватил привязку бота). Гарантия — триггер в БД
// (миграция 097), но signUp при его отказе падает безликим «Database error
// saving new user», поэтому проверяем заранее.
// Тело: { username } — с @ или без.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { username?: unknown } | null
  const username = typeof body?.username === 'string' ? body.username.trim().replace(/^@/, '') : ''
  if (!username || username.length > 64) {
    return Response.json({ error: 'Некорректный ник' }, { status: 400 })
  }
  const holder = await findTelegramNickHolder(createAdminClient(), username)
  return Response.json({ available: !holder })
}
