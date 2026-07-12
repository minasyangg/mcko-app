'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Send, CheckCircle2, CircleAlert, Bell, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  initialUsername: string
  connected: boolean               // chat_id привязан — бот уже пишет пользователю
  botUsername: string | null       // null = бот не настроен на сервере
  notificationsEnabled: boolean    // персональный выключатель
}

// Настройка уведомлений в профиле (общая для ученика и учителя):
// 1) персональный переключатель «получать уведомления»;
// 2) канал Telegram — ник + «Start» у бота (привязка по нику).
export function TelegramSettings({ initialUsername, connected, botUsername, notificationsEnabled }: Props) {
  const [username, setUsername] = useState(initialUsername)
  const [saved, setSaved] = useState(initialUsername)
  const [isConnected, setIsConnected] = useState(connected)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(notificationsEnabled)
  const [togglingEnabled, setTogglingEnabled] = useState(false)

  const usernameValid = username.trim() === '' || /^[A-Za-z0-9_]{5,32}$/.test(username.trim())

  async function handleToggleEnabled() {
    const next = !enabled
    setEnabled(next) // оптимистично
    setTogglingEnabled(true)
    try {
      const res = await fetch('/api/profile/telegram', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifications_enabled: next }),
      })
      if (!res.ok) {
        setEnabled(!next)
        const d = await res.json().catch(() => ({}))
        toast.error(d.error ?? 'Ошибка сохранения')
        return
      }
      toast.success(next ? 'Уведомления включены' : 'Уведомления выключены')
    } finally {
      setTogglingEnabled(false)
    }
  }

  async function handleSave() {
    if (!usernameValid) { toast.error('Ник Telegram: 5–32 символа, латиница/цифры/_'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/profile/telegram', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'Ошибка сохранения')
        return
      }
      setSaved(data.username ?? '')
      setUsername(data.username ?? '')
      if (data.relink_required) {
        setIsConnected(false)
        toast.success('Ник сохранён. Теперь откройте бота и нажмите «Start».')
      } else {
        toast.success(data.username ? 'Ник сохранён' : 'Telegram отвязан')
        if (!data.username) setIsConnected(false)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Персональный выключатель */}
      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="rounded-full bg-primary/10 p-2 shrink-0">
              <Bell className="h-4 w-4 text-primary" />
            </div>
            <div className="space-y-0.5 min-w-0">
              <p className="text-sm font-medium">Получать уведомления</p>
              <p className="text-xs text-muted-foreground">
                Оповещения о новых заданиях и результатах проверки. Можно выключить в любой момент.
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={togglingEnabled}
            onClick={handleToggleEnabled}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
              enabled ? 'bg-primary' : 'bg-muted-foreground/25',
              togglingEnabled && 'opacity-50',
            )}
          >
            <span className={cn(
              'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
              enabled ? 'translate-x-5' : 'translate-x-0.5',
            )} />
          </button>
        </CardContent>
      </Card>

      {/* Канал Telegram */}
      <Card className={cn(!enabled && 'opacity-60')}>
        <CardContent className="py-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="rounded-full bg-sky-500/10 p-2">
                <Send className="h-4 w-4 text-sky-500" />
              </div>
              <div>
                <p className="text-sm font-medium leading-tight">Telegram</p>
                <p className="text-xs text-muted-foreground">Канал доставки уведомлений</p>
              </div>
            </div>
            {botUsername !== null && (
              isConnected ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-600 shrink-0">
                  <CheckCircle2 className="h-4 w-4" /> Подключено
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-orange-500 shrink-0">
                  <CircleAlert className="h-4 w-4" /> Не подключено
                </span>
              )
            )}
          </div>

          {botUsername === null ? (
            <p className="text-sm text-muted-foreground border-t pt-4">
              Telegram-бот пока не настроен администратором — уведомления недоступны.
            </p>
          ) : (
            <div className="border-t pt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="tg-username" className="text-xs">Ваш ник в Telegram</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1 max-w-xs">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
                    <Input
                      id="tg-username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value.replace(/^@/, ''))}
                      placeholder="username"
                      className="pl-7"
                    />
                  </div>
                  <Button onClick={handleSave} disabled={saving || username === saved || !usernameValid}>
                    {saving ? 'Сохранение...' : 'Сохранить'}
                  </Button>
                </div>
                {!usernameValid && <p className="text-xs text-destructive">5–32 символа: латиница, цифры, _</p>}
              </div>

              {!isConnected && (
                <div className="rounded-md bg-muted/50 px-3.5 py-3 text-sm space-y-1.5">
                  <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Как подключить</p>
                  <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Укажите ник вашего Telegram и сохраните.</li>
                    <li className="inline">
                      Откройте бота{' '}
                      <a
                        href={`https://t.me/${botUsername}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary font-medium underline underline-offset-2"
                      >
                        @{botUsername}<ExternalLink className="h-3 w-3" />
                      </a>{' '}
                      и нажмите <span className="font-medium text-foreground">Start</span>.
                    </li>
                  </ol>
                </div>
              )}
              {isConnected && (
                <p className="text-xs text-muted-foreground">
                  Отключить можно командой /stop в чате с ботом или очистив ник.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
