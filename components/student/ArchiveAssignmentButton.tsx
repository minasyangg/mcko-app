'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Archive, ArchiveRestore, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

// Архив заданий ученика (113): убрать старое задание из «Мои задания» или
// вернуть его. Сервер сам проверяет, что задание выдано больше полугода назад
// (POST /api/student/archive), кнопка лишь не показывается у свежих.
export function ArchiveAssignmentButton({
  assignmentId, title, archived,
}: { assignmentId: string; title: string; archived: boolean }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function send(method: 'POST' | 'DELETE') {
    setLoading(true)
    try {
      const res = await fetch(
        method === 'POST' ? '/api/student/archive' : `/api/student/archive?assignment_id=${assignmentId}`,
        method === 'POST'
          ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignment_id: assignmentId }) }
          : { method }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Не получилось'); return }
      toast.success(method === 'POST' ? 'Задание убрано в архив' : 'Задание возвращено в «Мои задания»')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  if (archived) {
    return (
      <Button variant="outline" size="sm" className="w-full" disabled={loading} onClick={() => send('DELETE')}>
        {loading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ArchiveRestore className="h-3.5 w-3.5 mr-1.5" />}
        Вернуть из архива
      </Button>
    )
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full h-7 text-xs text-muted-foreground" disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Archive className="h-3.5 w-3.5 mr-1.5" />}
          В архив
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Убрать в архив?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>«{title}» выдано больше полугода назад. Задание пропадёт из списка и будет закрыто — решать его дальше будет нельзя.</p>
              <p>Результат сохранится у учителя. Если вы не дали ни одного ответа, задание засчитается как не сделанное — 0 баллов. Начатая попытка с ответами будет сдана на проверку.</p>
              <p>Вернуть задание можно во вкладке «Архив».</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={() => send('POST')}>Убрать в архив</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
