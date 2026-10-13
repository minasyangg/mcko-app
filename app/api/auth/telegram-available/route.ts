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
//
// Ответ «занят» сам по себе раскрывает, что у владельца ника есть аккаунт
// на платформе, поэтому частоту ограничиваем: человеку на форме хватает
// пары запросов, а перебор списка ников упирается в лимит. Счётчик живёт в
// памяти экземпляра функции — это не строгий лимит, а помеха перебору.
const WINDOW_MS = 10 * 60 * 1000
const MAX_PER_WINDOW = 10
const hits = new Map<string, number[]>()

function throttled(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  recent.push(now)
  hits.set(ip, recent)
  // карта не растёт бесконечно: старые адреса выбрасываем при уборке
  if (hits.size > 5000) {
    for (const [key, times] of hits) if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(key)
  }
  return recent.length > MAX_PER_WINDOW
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
  if (throttled(ip)) {
    return Response.json({ error: 'Слишком много проверок — попробуйте через несколько минут' }, { status: 429 })
  }

  const body = await request.json().catch(() => null) as { username?: unknown } | null
  const username = typeof body?.username === 'string' ? body.username.trim().replace(/^@/, '') : ''
  if (!username || username.length > 64) {
    return Response.json({ error: 'Некорректный ник' }, { status: 400 })
  }
  const holder = await findTelegramNickHolder(createAdminClient(), username)
  return Response.json({ available: !holder })
}
