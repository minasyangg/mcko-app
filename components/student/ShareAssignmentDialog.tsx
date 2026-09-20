'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog'
import { Share2, Loader2, X } from 'lucide-react'

interface Recipient { teacher_id: string; full_name: string }
interface ActiveShare { id: string; teacher_id: string; teacher_name: string; expires_at: string }

// Кнопка "Поделиться" на карточке сданной работы (StudentHome.tsx) —
// расшаривает всё назначение целиком (условия + ответы + баллы) одному из
// учителей, разрешённых администратором (student_share_recipients, 087).
// Список получателей и уже активные гранты подгружаются лениво при открытии
// диалога — не на каждой карточке списка, только когда ученик реально нажал
// "Поделиться".
export function ShareAssignmentDialog({ assignmentId, testTitle }: {
  assignmentId: string
  testTitle: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [activeShares, setActiveShares] = useState<ActiveShare[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  async function loadState() {
    setLoading(true)
    try {
      const [recipientsRes, sharesRes] = await Promise.all([
        fetch('/api/student/share-recipients'),
        fetch(`/api/student/assignment-shares?assignment_id=${assignmentId}`),
      ])
      const recipientsJson = await recipientsRes.json().catch(() => ({}))
      const sharesJson = await sharesRes.json().catch(() => ({}))
      setEnabled(recipientsJson.enabled ?? false)
      setRecipients(recipientsJson.recipients ?? [])
      setActiveShares(sharesJson.shares ?? [])
    } finally {
      setLoading(false)
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) loadState()
  }

  async function share(teacherId: string) {
    setBusy(teacherId)
    try {
      const res = await fetch('/api/student/assignment-shares', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignment_id: assignmentId, teacher_id: teacherId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Не удалось поделиться'); return }
      toast.success('Работа расшарена')
      await loadState()
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function revoke(shareId: string) {
    setBusy(shareId)
    try {
      const res = await fetch('/api/student/assignment-shares', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: shareId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Не удалось отозвать'); return }
      toast.success('Доступ отозван')
      await loadState()
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  const sharedTeacherIds = new Set(activeShares.map(s => s.teacher_id))
  const availableRecipients = recipients.filter(r => !sharedTeacherIds.has(r.teacher_id))

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <Share2 className="h-3.5 w-3.5 mr-1.5" />
          Поделиться
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Поделиться работой</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">«{testTitle}»</p>

          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !enabled || recipients.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              Поделиться работой могут только ученики, для которых администратор настроил список
              учителей. Обратитесь к администратору.
            </p>
          ) : (
            <>
              {activeShares.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Уже расшарено:</p>
                  {activeShares.map(s => (
                    <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                      <span>{s.teacher_name}</span>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                        <span>до {new Date(s.expires_at).toLocaleDateString('ru-RU')}</span>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={busy === s.id}
                          onClick={() => revoke(s.id)} title="Отозвать доступ">
                          {busy === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {availableRecipients.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Поделиться с:</p>
                  {availableRecipients.map(r => (
                    <Button key={r.teacher_id} variant="outline" size="sm" className="w-full justify-start"
                      disabled={busy === r.teacher_id} onClick={() => share(r.teacher_id)}>
                      {busy === r.teacher_id ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Share2 className="h-3.5 w-3.5 mr-2" />}
                      {r.full_name}
                    </Button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Закрыть</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
