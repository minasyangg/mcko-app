'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Check, X } from 'lucide-react'

interface Props {
  requestId: string
  studentName: string
}

export function SolutionRequestActions({ requestId, studentName }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const [rejectDialog, setRejectDialog] = useState(false)
  const [teacherNote, setTeacherNote] = useState('')

  async function approve() {
    setLoading('approve')
    const { data: { user } } = await supabase.auth.getUser()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { error } = await supabase
      .from('solution_requests')
      .update({
        status: 'approved',
        resolved_by: user?.id,
        resolved_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .eq('id', requestId)

    if (error) {
      toast.error('Ошибка при одобрении')
    } else {
      toast.success(`Доступ к решению открыт для ${studentName}`)
      router.refresh()
    }
    setLoading(null)
  }

  async function reject() {
    setLoading('reject')
    const { data: { user } } = await supabase.auth.getUser()

    const { error } = await supabase
      .from('solution_requests')
      .update({
        status: 'rejected',
        resolved_by: user?.id,
        resolved_at: new Date().toISOString(),
        teacher_note: teacherNote || null,
      })
      .eq('id', requestId)

    if (error) {
      toast.error('Ошибка при отклонении')
    } else {
      toast.success('Запрос отклонён')
      router.refresh()
    }
    setRejectDialog(false)
    setLoading(null)
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="default"
          onClick={approve}
          disabled={loading !== null}
        >
          <Check className="h-3.5 w-3.5 mr-1" />
          Одобрить
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRejectDialog(true)}
          disabled={loading !== null}
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Отклонить
        </Button>
      </div>

      <Dialog open={rejectDialog} onOpenChange={setRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отклонить запрос</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Комментарий для ученика (необязательно)"
            value={teacherNote}
            onChange={(e) => setTeacherNote(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={reject}
              disabled={loading === 'reject'}
            >
              Отклонить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
