// Канал «Telegram» модуля уведомлений: тонкая обёртка над Bot API.
// Токен бота — env TELEGRAM_BOT_TOKEN (задаётся в Vercel; без него канал
// молча выключен и notify() пишет skipped в журнал).

const API = 'https://api.telegram.org'

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN
}

async function call<T>(method: string, body?: Record<string, unknown>): Promise<{ ok: boolean; result?: T; description?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false, description: 'TELEGRAM_BOT_TOKEN не задан' }
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    return await res.json()
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : 'network error' }
  }
}

// Отправка сообщения пользователю. Возвращает ошибку текстом (null = успех).
export async function sendTelegramMessage(chatId: number, text: string): Promise<string | null> {
  const res = await call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true })
  return res.ok ? null : (res.description ?? 'send failed')
}

// Имя бота (для ссылки t.me/<bot>) — кэшируется на время жизни инстанса
let cachedBotUsername: string | null | undefined
export async function getBotUsername(): Promise<string | null> {
  if (cachedBotUsername !== undefined) return cachedBotUsername
  const res = await call<{ username?: string }>('getMe')
  cachedBotUsername = res.ok ? (res.result?.username ?? null) : null
  return cachedBotUsername
}

export async function getWebhookInfo(): Promise<{ url: string; last_error_message?: string } | null> {
  const res = await call<{ url: string; last_error_message?: string }>('getWebhookInfo')
  return res.ok ? (res.result ?? null) : null
}

export async function setTelegramWebhook(url: string): Promise<string | null> {
  const res = await call('setWebhook', {
    url,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
    drop_pending_updates: true,
    allowed_updates: ['message'],
  })
  return res.ok ? null : (res.description ?? 'setWebhook failed')
}
