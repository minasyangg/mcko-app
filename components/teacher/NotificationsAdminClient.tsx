'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { NOTIFICATION_EVENTS } from '@/lib/notifications/types'
import { Bot, Send, GraduationCap, UserRound, Mail, Clock } from 'lucide-react'
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

// Переключатель события — общий для каналов
function EventToggle({
  title, description, audience, enabled, saving, disabled, onToggle,
}: {
  title: string
  description: string
  audience: 'student' | 'teacher'
  enabled: boolean
  saving: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <div className="space-y-0.5 min-w-0">
        <p className="text-sm font-medium flex items-center gap-2">
          {audience === 'student'
            ? <GraduationCap className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            : <UserRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          {title}
          <span className="text-[11px] font-normal text-muted-foreground">
            · {audience === 'student' ? 'ученику' : 'учителю'}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={saving || disabled}
        onClick={onToggle}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors mt-0.5',
          enabled && !disabled ? 'bg-primary' : 'bg-muted-foreground/25',
          (saving || disabled) && 'opacity-50 cursor-not-allowed',
        )}
      >
        <span className={cn(
          'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
          enabled ? 'translate-x-5' : 'translate-x-0.5',
        )} />
      </button>
    </div>
  )
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
    <Tabs defaultValue="telegram" className="w-full">
      <TabsList>
        <TabsTrigger value="telegram" className="gap-1.5">
          <Send className="h-3.5 w-3.5" /> Telegram
        </TabsTrigger>
        <TabsTrigger value="email" className="gap-1.5">
          <Mail className="h-3.5 w-3.5" /> Почта
        </TabsTrigger>
      </TabsList>

      {/* ── Telegram ── */}
      <TabsContent value="telegram" className="pt-4 space-y-6">
        {/* Статус бота */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4 w-4" />
              Бот
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {bot === null ? (
              <p className="text-muted-foreground">Проверка состояния...</p>
            ) : !bot.configured ? (
              <div className="space-y-1.5">
                <Badge variant="outline" className="text-orange-600 border-orange-300">Не настроен</Badge>
                <p className="text-muted-foreground">
                  Задайте переменные окружения <code className="text-xs bg-muted px-1 rounded">TELEGRAM_BOT_TOKEN</code> (токен от @BotFather)
                  и <code className="text-xs bg-muted px-1 rounded">TELEGRAM_WEBHOOK_SECRET</code> (случайная строка) в Vercel, затем переоткройте страницу.
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
                    <span className="text-xs text-orange-600">TELEGRAM_WEBHOOK_SECRET не задан</span>
                  )}
                </div>
                {bot.webhook_error && (
                  <p className="text-xs text-destructive">Последняя ошибка webhook: {bot.webhook_error}</p>
                )}
                <div className="flex items-center gap-3 pt-1">
                  <Button size="sm" variant="outline" onClick={handleSetWebhook} disabled={settingWebhook}>
                    {settingWebhook ? 'Установка...' : bot.webhook_url ? 'Переустановить webhook' : 'Установить webhook'}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Пользователи подключаются в настройках профиля: ник + «Start» у бота.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* События */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">О чём уведомлять</CardTitle>
          </CardHeader>
          <CardContent className="divide-y pt-0">
            {NOTIFICATION_EVENTS.map(ev => (
              <EventToggle
                key={ev.type}
                title={ev.title}
                description={ev.description}
                audience={ev.audience}
                enabled={settings[ev.type] ?? true}
                saving={savingType === ev.type}
                onToggle={() => toggle(ev.type)}
              />
            ))}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── Почта (заготовка) ── */}
      <TabsContent value="email" className="pt-4">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-14 text-center gap-3">
            <div className="rounded-full bg-muted p-3">
              <Mail className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium flex items-center justify-center gap-1.5">
                <Clock className="h-4 w-4 text-muted-foreground" /> В разработке
              </p>
              <p className="text-sm text-muted-foreground max-w-sm">
                Канал «Почта» появится позже. Настройки событий будут здесь, рядом с Telegram —
                модуль рассчитан на несколько каналов (в дальнейшем и другие мессенджеры).
              </p>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
