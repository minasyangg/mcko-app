import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTelegramMessage } from '@/lib/notifications/telegram'

// Webhook Telegram-бота. Единственная задача — привязка/отвязка аккаунта:
//   /start → ищем профиль по telegram_username (ник задаётся в настройках
//            профиля на платформе) и сохраняем chat_id — теперь можно слать
//            уведомления этому пользователю;
//   /stop  → отвязываем chat_id (уведомления перестают приходить).
// Подлинность запроса — заголовок X-Telegram-Bot-Api-Secret-Token, который
// Telegram присылает, если webhook установлен с secret_token (см. setup).
export async function POST(request: NextRequest) {
  // fail-closed: без настроенного секрета webhook не работает вовсе — иначе
  // публичный эндпоинт принимал бы фейковые /start и позволял привязать
  // чужой профиль (по известному нику) к чату злоумышленника
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) return Response.json({ error: 'webhook not configured' }, { status: 503 })
  if (request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return Response.json({ ok: false }, { status: 401 })
  }

  // Telegram ретраит не-200 ответы, поэтому всегда отвечаем ok
  try {
    const update = await request.json().catch(() => null) as {
      message?: {
        text?: string
        chat?: { id?: number }
        from?: { username?: string; first_name?: string }
      }
    } | null

    const msg = update?.message
    const chatId = msg?.chat?.id
    const text = (msg?.text ?? '').trim()
    if (!chatId || !text.startsWith('/')) return Response.json({ ok: true })

    const admin = createAdminClient()

    if (text.startsWith('/stop')) {
      await admin.from('profiles')
        .update({ telegram_chat_id: null })
        .eq('telegram_chat_id', chatId)
      await sendTelegramMessage(chatId, 'Уведомления отключены. Чтобы включить снова — отправьте /start.')
      return Response.json({ ok: true })
    }

    if (text.startsWith('/start')) {
      const username = msg?.from?.username
      if (!username) {
        await sendTelegramMessage(chatId,
          'У вашего Telegram-аккаунта нет имени пользователя (@username). ' +
          'Задайте его в настройках Telegram, укажите в профиле на платформе и отправьте /start ещё раз.')
        return Response.json({ ok: true })
      }

      // ник в профиле хранится без @, сравнение регистронезависимое;
      // _ и % — wildcard'ы LIKE, экранируем, чтобы john_doe не совпал с johnXdoe
      const { data: matches } = await admin
        .from('profiles')
        .select('id, full_name')
        .ilike('telegram_username', username.replace(/[\\%_]/g, '\\$&'))
        .is('deleted_at', null)

      if (!matches || matches.length === 0) {
        await sendTelegramMessage(chatId,
          `Ник @${username} не найден на платформе. ` +
          'Откройте настройки профиля на сайте, укажите этот ник в поле «Telegram» и отправьте /start ещё раз.')
        return Response.json({ ok: true })
      }

      // Ник уникальным ограничением не защищён, и раньше chat_id проставлялся
      // ВСЕМ совпавшим профилям — один чат начинал получать уведомления за
      // несколько человек (ФИО учеников, баллы), то есть утечку. Привязываем
      // только при однозначном совпадении.
      if (matches.length > 1) {
        await sendTelegramMessage(chatId,
          `Ник @${username} указан сразу у нескольких профилей на платформе, ` +
          'поэтому подключить уведомления нельзя — непонятно, кому они предназначены. ' +
          'Обратитесь к администратору, чтобы лишний профиль убрал этот ник.')
        return Response.json({ ok: true })
      }

      const profile = matches[0]

      // Один чат — один профиль: снимаем прежние привязки этого же чата.
      // Иначе после смены ника старый профиль остаётся привязанным к чату и
      // продолжает слать в него чужие уведомления.
      await admin.from('profiles')
        .update({ telegram_chat_id: null })
        .eq('telegram_chat_id', chatId)
        .neq('id', profile.id)

      await admin.from('profiles')
        .update({ telegram_chat_id: chatId })
        .eq('id', profile.id)

      await sendTelegramMessage(chatId,
        `✅ Готово, ${profile.full_name}! Уведомления платформы подключены. ` +
        'Отключить можно командой /stop.')
      return Response.json({ ok: true })
    }

    return Response.json({ ok: true })
  } catch (e) {
    console.error('[telegram webhook]', e)
    return Response.json({ ok: true })
  }
}
