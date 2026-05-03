'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { BookOpen, Clock, CheckCircle2 } from 'lucide-react'

type RequestStatus = 'none' | 'pending' | 'approved' | 'rejected'

interface Props {
  attemptId: string
  taskId: string
  taskNumber: number
  initialStatus: RequestStatus
}

export function SolutionRequestButton({ attemptId, taskId, taskNumber, initialStatus }: Props) {
  const [status, setStatus] = useState<RequestStatus>(initialStatus)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  if (status === 'approved') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Разбор открыт
      </span>
    )
  }

  if (status === 'pending') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        Запрос отправлен
      </span>
    )
  }

  if (status === 'rejected') {
    return (
      <span className="text-xs text-muted-foreground">Запрос отклонён</span>
    )
  }

  async function submit() {
    setLoading(true)
    try {
      const res = await fetch('/api/solution-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attempt_id: attemptId, task_id: taskId, student_message: message }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Ошибка при отправке запроса')
        return
      }
      setStatus('pending')
      setDialogOpen(false)
      toast.success(`Запрос на разбор задачи №${taskNumber} отправлен`)
    } catch {
      toast.error('Ошибка сети')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setDialogOpen(true)}
        className="text-xs h-7"
      >
        <BookOpen className="h-3.5 w-3.5 mr-1.5" />
        Запросить разбор
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Запрос разбора — задача №{taskNumber}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Учитель получит уведомление и откроет вам доступ к решению.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="msg">Что непонятно? <span className="text-muted-foreground">(необязательно)</span></Label>
              <Textarea
                id="msg"
                placeholder="Опишите, что вызвало затруднение..."
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={submit} disabled={loading}>
              {loading ? 'Отправка...' : 'Отправить запрос'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
