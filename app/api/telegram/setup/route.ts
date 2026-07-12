import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/authorize'
import { getBotUsername, getWebhookInfo, setTelegramWebhook, telegramConfigured } from '@/lib/notifications/telegram'

// GET — статус бота для админ-панели (токен задан? имя бота? webhook?)
export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  if (!telegramConfigured()) {
    return Response.json({ configured: false })
  }
  const [botUsername, webhook] = await Promise.all([getBotUsername(), getWebhookInfo()])
  return Response.json({
    configured: true,
    bot_username: botUsername,
    webhook_url: webhook?.url ?? null,
    webhook_error: webhook?.last_error_message ?? null,
    secret_set: !!process.env.TELEGRAM_WEBHOOK_SECRET,
  })
}

// POST — установить webhook бота на этот деплой (кнопка в админ-панели)
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  if (!telegramConfigured()) {
    return Response.json({ error: 'TELEGRAM_BOT_TOKEN не задан в переменных окружения' }, { status: 400 })
  }

  // За прокси Vercel протокол приходит в x-forwarded-proto; локальный http
  // Telegram не примет — webhook ставится только с https-домена
  const url = new URL(request.url)
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')
  const host = request.headers.get('x-forwarded-host') ?? url.host
  if (proto !== 'https') {
    return Response.json({ error: 'Webhook можно установить только с https-домена (продакшен/превью)' }, { status: 400 })
  }

  const webhookUrl = `https://${host}/api/telegram/webhook`
  const err = await setTelegramWebhook(webhookUrl)
  if (err) return Response.json({ error: err }, { status: 502 })
  return Response.json({ ok: true, webhook_url: webhookUrl })
}
