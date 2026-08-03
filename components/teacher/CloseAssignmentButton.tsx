'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { CheckCheck, Loader2, RotateCcw } from 'lucide-react'

interface Props {
  assignmentId: string
  /** Закрыть только для одного ученика; без него — всё назначение */
  studentId?: string
  /**
   * Текущее состояние закрытия: 'forced' — можно открыть заново, остальные
   * причины (max_score / attempts_exhausted) закрывают назначение сами по себе
   * и кнопкой не управляются, null — открыто.
   */
  closedReason: string | null
  /** Кого именно завершаем — для текста подтверждения */
  targetLabel: string
  size?: 'sm' | 'row'
  label?: string
}

// Принудительное завершение назначения учителем: попытки, оставшиеся у ученика,
// больше не доступны, а всё несданное доводится до результата, чтобы попасть в
// статистику (см. lib/assignments/close.ts). Обратное действие — «открыть
// заново» — снимает только принудительное закрытие: исчерпанные попытки оно не
// возвращает, поэтому кнопка не обещает восстановление доступа.
export function CloseAssignmentButton({
  assignmentId, studentId, closedReason, targetLabel, size = 'sm', label = 'Завершить',
}: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const qs = studentId ? `?student_id=${studentId}` : ''

  async function handleClose() {
    setLoading(true)
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(studentId ? { student_id: studentId } : {}),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка завершения'); return }
      const parts = [`Завершено для ${json.closed_students ?? 0} уч.`]
      if (json.finished_attempts) parts.push(`сдано попыток: ${json.finished_attempts}`)
      if (json.expired) parts.push(`не начали: ${json.expired}`)
      toast.success(parts.join(', '))
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  async function handleReopen() {
    setLoading(true)
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/close${qs}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка'); return }
      toast.success('Назначение открыто заново')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  const btnClass = size === 'row' ? 'h-8 px-2 text-xs' : 'px-2'

  if (closedReason === 'forced') {
    return (
      <Button
        variant="ghost" size="sm" className={btnClass} disabled={loading}
        onClick={handleReopen}
        title="Снять принудительное завершение (потраченные попытки не возвращаются)"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        <span className="ml-1">Открыть</span>
      </Button>
    )
  }

  // Закрыто расчётной причиной (полный балл / исчерпанные попытки) — завершать
  // нечего, а «открыть» такое назначение кнопка не может: причина вернётся при
  // первом же пересчёте итога.
  if (closedReason) return null

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost" size="sm" disabled={loading}
          className={`${btnClass} text-orange-600 hover:text-orange-700 hover:bg-orange-50`}
          title="Завершить принудительно, не дожидаясь остатка попыток"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
          <span className="ml-1">{label}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Завершить принудительно?</AlertDialogTitle>
          <AlertDialogDescription>
            {targetLabel} больше не сможет начать новую попытку, даже если лимит попыток
            не исчерпан. Начатые попытки будут сданы и проверены автоматически, не начатые —
            помечены истёкшими. Итоговые баллы сохранятся в результатах и попадут в статистику.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); handleClose() }} disabled={loading}>
            {loading ? 'Завершение...' : 'Завершить'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
