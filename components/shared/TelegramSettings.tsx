'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Send, CheckCircle2, CircleAlert } from 'lucide-react'

interface Props {
  initialUsername: string
  connected: boolean          // chat_id привязан — бот уже пишет пользователю
  botUsername: string | null  // null = бот не настроен на сервере
}

// Настройка Telegram-уведомлений в профиле (общая для ученика и учителя):
// 1) сохранить свой ник; 2) открыть бота и нажать «Start» — привязка по нику.
export function TelegramSettings({ initialUsername, connected, botUsername }: Props) {
  const [username, setUsername] = useState(initialUsername)
  const [saved, setSaved] = useState(initialUsername)
  const [isConnected, setIsConnected] = useState(connected)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-4 w-4 text-sky-500" />
          Уведомления в Telegram
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {botUsername === null ? (
          <p className="text-sm text-muted-foreground">
            Telegram-бот пока не настроен администратором — уведомления недоступны.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm">
              {isConnected ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  <span>Подключено — уведомления приходят в Telegram.</span>
                </>
              ) : (
                <>
                  <CircleAlert className="h-4 w-4 text-orange-500 shrink-0" />
                  <span className="text-muted-foreground">
                    {saved ? 'Ник сохранён, но бот ещё не подключён.' : 'Уведомления не подключены.'}
                  </span>
                </>
              )}
            </div>

            <div className="space-y-1.5 max-w-sm">
              <Label htmlFor="tg-username">Ваш ник в Telegram</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
                  <Input
                    id="tg-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.replace(/^@/, ''))}
                    placeholder="username"
                    className="pl-7"
                  />
                </div>
                <Button onClick={handleSave} disabled={saving || username === saved}>
                  {saving ? 'Сохранение...' : 'Сохранить'}
                </Button>
              </div>
            </div>

            {!isConnected && (
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Укажите ник вашего Telegram-аккаунта и сохраните.</li>
                <li>
                  Откройте бота{' '}
                  <a
                    href={`https://t.me/${botUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2"
                  >
                    @{botUsername}
                  </a>{' '}
                  и нажмите <span className="font-medium text-foreground">Start</span>.
                </li>
              </ol>
            )}
            {isConnected && (
              <p className="text-xs text-muted-foreground">
                Отключить уведомления можно командой /stop в чате с ботом или очистив ник.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
