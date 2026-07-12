'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NOTIFICATION_EVENTS } from '@/lib/notifications/types'
import { Bot, Send, GraduationCap, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BotStatus {
  configured: boolean
  bot_username?: string | null
  webhook_url?: string | null
  webhook_error?: string | null
  secret_set?: boolean
}

interface Props {
  // event_type → enabled (из notification_settings; отсутствие строки = true)
  initialSettings: Record<string, boolean>
}

export function NotificationsAdminClient({ initialSettings }: Props) {
  const [settings, setSettings] = useState(initialSettings)
  const [savingType, setSavingType] = useState<string | null>(null)
  const [bot, setBot] = useState<BotStatus | null>(null)
  const [settingWebhook, setSettingWebhook] = useState(false)

  useEffect(() => {
    fetch('/api/telegram/setup')
      .then(r => r.json())
      .then(setBot)
      .catch(() => setBot({ configured: false }))
  }, [])

  async function toggle(eventType: string) {
    const next = !(settings[eventType] ?? true)
    setSavingType(eventType)
    try {
      const res = await fetch('/api/admin/notification-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_type: eventType, channel: 'telegram', enabled: next }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error ?? 'Ошибка сохранения')
        return
      }
      setSettings(prev => ({ ...prev, [eventType]: next }))
      toast.success(next ? 'Уведомление включено' : 'Уведомление выключено')
    } finally {
      setSavingType(null)
    }
  }

  async function handleSetWebhook() {
    setSettingWebhook(true)
    try {
      const res = await fetch('/api/telegram/setup', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error ?? 'Не удалось установить webhook')
        return
      }
      toast.success('Webhook установлен')
      setBot(prev => prev ? { ...prev, webhook_url: d.webhook_url, webhook_error: null } : prev)
    } finally {
      setSettingWebhook(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Статус бота */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Telegram-бот
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {bot === null ? (
            <p className="text-muted-foreground">Проверка состояния...</p>
          ) : !bot.configured ? (
            <div className="space-y-1">
              <Badge variant="outline" className="text-orange-600 border-orange-300">Не настроен</Badge>
              <p className="text-muted-foreground">
                Задайте переменные окружения <code className="text-xs bg-muted px-1 rounded">TELEGRAM_BOT_TOKEN</code> (токен от @BotFather)
                и <code className="text-xs bg-muted px-1 rounded">TELEGRAM_WEBHOOK_SECRET</code> (любая случайная строка) в Vercel, затем переоткройте страницу.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
                <span>Бот: <span className="font-medium">@{bot.bot_username ?? '—'}</span></span>
                <span className="flex items-center gap-1.5">
                  Webhook:{' '}
                  {bot.webhook_url
                    ? <Badge variant="default" className="text-xs">активен</Badge>
                    : <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">не установлен</Badge>}
                </span>
                {!bot.secret_set && (
                  <span className="text-xs text-orange-600">TELEGRAM_WEBHOOK_SECRET не задан — webhook без проверки подлинности</span>
                )}
              </div>
              {bot.webhook_url && (
                <p className="text-xs text-muted-foreground break-all">{bot.webhook_url}</p>
              )}
              {bot.webhook_error && (
                <p className="text-xs text-destructive">Последняя ошибка webhook: {bot.webhook_error}</p>
              )}
              <Button size="sm" variant="outline" onClick={handleSetWebhook} disabled={settingWebhook}>
                {settingWebhook ? 'Установка...' : bot.webhook_url ? 'Переустановить webhook' : 'Установить webhook'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Пользователи подключают уведомления в настройках профиля: указывают ник и нажимают Start у бота.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* События */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-4 w-4 text-sky-500" />
            События Telegram-уведомлений
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {NOTIFICATION_EVENTS.map(ev => {
            const enabled = settings[ev.type] ?? true
            return (
              <div key={ev.type} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-sm font-medium flex items-center gap-2">
                    {ev.audience === 'student'
                      ? <GraduationCap className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      : <UserRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    {ev.title}
                    <span className="text-[11px] font-normal text-muted-foreground">
                      · {ev.audience === 'student' ? 'ученику' : 'учителю'}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">{ev.description}</p>
                </div>
                {/* тумблер */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  disabled={savingType === ev.type}
                  onClick={() => toggle(ev.type)}
                  className={cn(
                    'relative inline-flex h-5.5 w-10 shrink-0 cursor-pointer rounded-full transition-colors mt-0.5',
                    enabled ? 'bg-primary' : 'bg-muted-foreground/30',
                    savingType === ev.type && 'opacity-50',
                  )}
                >
                  <span
                    className={cn(
                      'pointer-events-none inline-block h-4.5 w-4.5 translate-y-0.5 rounded-full bg-white shadow transition-transform',
                      enabled ? 'translate-x-5' : 'translate-x-0.5',
                    )}
                  />
                </button>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Канал «Почта» появится позже — модуль уведомлений рассчитан на несколько каналов,
        настройки для email будут на этой же странице.
      </p>
    </div>
  )
}
