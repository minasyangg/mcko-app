import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTelegramMessage } from '@/lib/notifications/telegram'

// Webhook Telegram-бота. Единственная задача — привязка/отвязка аккаунта:
//   /start → ищем профиль по telegram_username (ник задаётся в настройках
//            профиля на платформе) ИЛИ по parent_telegram_username (ник
//            родителя ученика указывает админ/учитель в карточке ученика —
//            у родителя своего аккаунта на платформе нет) и сохраняем
//            chat_id в соответствующее поле;
//   /stop  → отвязываем chat_id по обоим полям (уведомления перестают
//            приходить и как получателю, и как родителю).
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
      // Чат мог быть привязан либо как сам получатель, либо как родитель
      // ученика — отвязываем обе роли этого chat_id разом.
      await admin.from('profiles')
        .update({ telegram_chat_id: null })
        .eq('telegram_chat_id', chatId)
      await admin.from('profiles')
        .update({ parent_telegram_chat_id: null })
        .eq('parent_telegram_chat_id', chatId)
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
      // _ и % — wildcard'ы LIKE, экранируем, чтобы john_doe не совпал с johnXdoe.
      // Ищем сразу по двум полям: сам пользователь (telegram_username) и
      // родитель ученика (parent_telegram_username, ставится админом/учителем
      // в карточке ученика — своего аккаунта на платформе у родителя нет).
      const escaped = username.replace(/[\\%_]/g, '\\$&')
      const [{ data: ownMatches }, { data: parentMatches }] = await Promise.all([
        admin.from('profiles').select('id, full_name')
          .ilike('telegram_username', escaped).is('deleted_at', null),
        admin.from('profiles').select('id, full_name')
          .ilike('parent_telegram_username', escaped).is('deleted_at', null),
      ])

      const totalMatches = (ownMatches?.length ?? 0) + (parentMatches?.length ?? 0)

      if (totalMatches === 0) {
        await sendTelegramMessage(chatId,
          `Ник @${username} не найден на платформе. ` +
          'Откройте настройки профиля на сайте (или попросите это сделать администратора для родительского уведомления), ' +
          'укажите этот ник в поле «Telegram» и отправьте /start ещё раз.')
        return Response.json({ ok: true })
      }

      // Ник ничем уникальным не защищён (ни среди учеников/учителей, ни между
      // «свой ник» и «ник родителя»), и раньше chat_id проставлялся ВСЕМ
      // совпавшим профилям — один чат начинал получать уведомления за
      // несколько человек (ФИО учеников, баллы), то есть утечку. Привязываем
      // только при однозначном совпадении суммарно по обоим полям.
      if (totalMatches > 1) {
        await sendTelegramMessage(chatId,
          `Ник @${username} указан сразу у нескольких профилей на платформе, ` +
          'поэтому подключить уведомления нельзя — непонятно, кому они предназначены. ' +
          'Обратитесь к администратору, чтобы лишний профиль убрал этот ник.')
        return Response.json({ ok: true })
      }

      const asParent = (parentMatches?.length ?? 0) === 1
      const profile = asParent ? parentMatches![0] : ownMatches![0]

      // Один чат — одна роль: снимаем прежние привязки этого же chat_id по
      // ОБОИМ полям (кроме той, которую сейчас проставляем этому же профилю
      // ниже). Иначе после смены ника старый профиль (или старая роль на этом
      // же профиле) остаётся привязанным к чату и продолжает слать в него
      // чужие/дублирующие уведомления.
      let clearOwn = admin.from('profiles').update({ telegram_chat_id: null }).eq('telegram_chat_id', chatId)
      let clearParent = admin.from('profiles').update({ parent_telegram_chat_id: null }).eq('parent_telegram_chat_id', chatId)
      if (!asParent) clearOwn = clearOwn.neq('id', profile.id)
      if (asParent) clearParent = clearParent.neq('id', profile.id)
      await Promise.all([clearOwn, clearParent])

      if (asParent) {
        await admin.from('profiles').update({ parent_telegram_chat_id: chatId }).eq('id', profile.id)
      } else {
        await admin.from('profiles').update({ telegram_chat_id: chatId }).eq('id', profile.id)
      }

      const greeting = asParent
        ? `✅ Готово! Вы подключены как родитель ученика ${profile.full_name} — теперь будут приходить уведомления о его заданиях и результатах.`
        : `✅ Готово, ${profile.full_name}! Уведомления платформы подключены.`
      await sendTelegramMessage(chatId, `${greeting} Отключить можно командой /stop.`)
      return Response.json({ ok: true })
    }

    return Response.json({ ok: true })
  } catch (e) {
    console.error('[telegram webhook]', e)
    return Response.json({ ok: true })
  }
}
