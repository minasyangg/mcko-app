'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ConfirmDeleteAction } from '@/components/shared/ConfirmDeleteAction'
import { Trash2, Loader2, AlertTriangle, X } from 'lucide-react'

interface Usage {
  student_id: string
  full_name: string
  attempts: number
  assignments: number
  groups: number
}

/**
 * Массовое удаление учеников. Как и у тестов, сначала показывает разбор
 * связей: сколько попыток, назначений и групп затронуто.
 *
 * Удаление «мягкое» (delete_student_cascade): перед снятием попыток функция
 * переносит итоговый балл в student_final_results, поэтому статистика по
 * сданным работам сохраняется, а профиль помечается удалённым.
 */
export function BulkDeleteStudentsBar({
  selectedIds, onClear,
}: {
  selectedIds: string[]
  onClear: () => void
}) {
  const router = useRouter()
  const [usage, setUsage] = useState<Usage[] | null>(null)
  const [busy, setBusy] = useState(false)

  if (selectedIds.length === 0) return null

  async function preview() {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/students/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: selectedIds, dry_run: true }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Не удалось проверить связи'); return }
      setUsage(json.usage ?? [])
    } finally { setBusy(false) }
  }

  async function confirm() {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/students/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: selectedIds }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка удаления'); return }
      toast.success(`Удалено учеников: ${json.deleted}`)
      if (json.failed?.length) toast.error(`Не удалось удалить: ${json.failed.length}`)
      setUsage(null)
      onClear()
      router.refresh()
    } finally { setBusy(false) }
  }

  const withData = usage?.filter(u => u.attempts > 0) ?? []
  const totalAttempts = usage?.reduce((a, u) => a + u.attempts, 0) ?? 0

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <span className="text-sm">Выбрано: <b>{selectedIds.length}</b></span>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClear}>
          <X className="mr-1 h-3 w-3" /> Снять выделение
        </Button>
        <div className="flex-1" />
        <Button
          variant="outline" size="sm" disabled={busy}
          className="text-destructive hover:text-destructive"
          onClick={preview}
        >
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
          Удалить выбранных
        </Button>
      </div>

      <AlertDialog open={usage !== null} onOpenChange={(v) => { if (!v && !busy) setUsage(null) }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить {selectedIds.length} учеников?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Ученики будут сняты с назначений и групп, а их профили помечены удалёнными.
                  Итоговые баллы по сданным работам сохранятся в статистике.
                </p>

                {withData.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                    <div className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
                      <AlertTriangle className="h-4 w-4" />
                      Есть учебные данные: {withData.length} чел., попыток {totalAttempts}
                    </div>
                    <ul className="mt-1.5 space-y-0.5 text-amber-800/90 dark:text-amber-200/80">
                      {withData.slice(0, 5).map(u => (
                        <li key={u.student_id} className="truncate">
                          {u.full_name} — попыток {u.attempts}
                          {u.assignments > 0 && `, назначений ${u.assignments}`}
                          {u.groups > 0 && `, групп ${u.groups}`}
                        </li>
                      ))}
                      {withData.length > 5 && <li>…и ещё {withData.length - 5}</li>}
                    </ul>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
            <ConfirmDeleteAction onConfirm={confirm} />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
