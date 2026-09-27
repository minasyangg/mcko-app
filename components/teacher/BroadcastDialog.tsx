'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface Member {
  id: string
  full_name: string
}

interface Props {
  groupId: string
  groupLabel: string // «группе «10А»» / «программе «Броско-9-ОГЭ-М»» — для текста диалога
  members: Member[]
}

const MAX_LEN = 3500

export function BroadcastDialog({ groupId, groupLabel, members }: Props) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)

  function handleOpenChange(next: boolean) {
    if (next) {
      setMessage('')
      setExcluded(new Set())
    }
    setOpen(next)
  }

  function toggle(id: string) {
    setExcluded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const recipientCount = members.length - excluded.size
  const trimmed = message.trim()

  async function handleSend() {
    if (!trimmed) {
      toast.error('Введите текст сообщения')
      return
    }
    if (recipientCount === 0) {
      toast.error('Выберите хотя бы одного получателя')
      return
    }
    setSending(true)
    try {
      const res = await fetch(`/api/groups/${groupId}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, excludeStudentIds: [...excluded] }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? 'Не удалось отправить рассылку')
        return
      }
      const { sent = 0, failed = 0, noTelegram = 0 } = json as { sent?: number; failed?: number; noTelegram?: number }
      if (sent === 0 && failed === 0) {
        toast.warning(`Сообщение принято, но ни у кого из ${noTelegram} получателей нет привязанного Telegram`)
      } else if (failed > 0 || noTelegram > 0) {
        const parts = [`отправлено ${sent}`]
        if (failed > 0) parts.push(`ошибка у ${failed}`)
        if (noTelegram > 0) parts.push(`без Telegram ${noTelegram}`)
        toast.warning(`Рассылка: ${parts.join(', ')}`)
      } else {
        toast.success(`Сообщение отправлено (${sent})`)
      }
      setOpen(false)
    } catch {
      toast.error('Не удалось отправить рассылку')
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Send className="h-4 w-4 mr-1.5" />
          Написать
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Сообщение {groupLabel}</DialogTitle>
          <DialogDescription>
            Уйдёт в Telegram всем отмеченным ученикам и их привязанным родителям. Ученики без привязанного Telegram сообщение не получат.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="broadcast-message">Текст сообщения *</Label>
            <Textarea
              id="broadcast-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Например: завтра занятие переносится на 15:00"
              rows={5}
              maxLength={MAX_LEN}
              autoFocus
            />
            <p className="text-xs text-muted-foreground text-right">{message.length}/{MAX_LEN}</p>
          </div>

          <div>
            <Label className="mb-2 block">
              Получатели ({recipientCount} из {members.length})
            </Label>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">В группе нет участников</p>
            ) : (
              <div className="rounded-md border max-h-56 overflow-y-auto divide-y">
                {members.map((m) => (
                  <label
                    key={m.id}
                    className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input accent-primary"
                      checked={!excluded.has(m.id)}
                      onChange={() => toggle(m.id)}
                    />
                    <span>{m.full_name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={sending}>
            Отмена
          </Button>
          <Button onClick={handleSend} disabled={sending || !trimmed || recipientCount === 0}>
            {sending ? 'Отправка...' : `Отправить (${recipientCount})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
