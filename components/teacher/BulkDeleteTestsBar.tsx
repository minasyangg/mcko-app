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
import { Trash2, Loader2, AlertTriangle, Archive, X } from 'lucide-react'

interface Usage {
  test_id: string
  title: string
  attempts: number
  assignments: number
  roadmap_items: number
  mode: 'hard' | 'soft'
}

/**
 * Панель массового удаления тестов/ДЗ. Появляется, когда что-то отмечено.
 *
 * Перед удалением всегда запрашивает разбор связей (dry_run) и показывает его:
 * сколько тестов сотрётся полностью, а сколько будет скрыто ради сохранности
 * результатов учеников, и что зацеплено (назначения, программы).
 */
export function BulkDeleteTestsBar({
  selectedIds, onClear, label = 'задание',
}: {
  selectedIds: string[]
  onClear: () => void
  label?: string
}) {
  const router = useRouter()
  const [usage, setUsage] = useState<Usage[] | null>(null)
  const [busy, setBusy] = useState(false)

  if (selectedIds.length === 0) return null

  async function preview() {
    setBusy(true)
    try {
      const res = await fetch('/api/tests/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_ids: selectedIds, dry_run: true }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Не удалось проверить связи'); return }
      setUsage(json.usage ?? [])
    } finally { setBusy(false) }
  }

  async function confirm() {
    setBusy(true)
    try {
      const res = await fetch('/api/tests/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_ids: selectedIds }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка удаления'); return }

      const parts: string[] = []
      if (json.deleted) parts.push(`удалено полностью: ${json.deleted}`)
      if (json.hidden) parts.push(`скрыто с сохранением результатов: ${json.hidden}`)
      toast.success(parts.join(', ') || 'Готово')
      if (json.failed?.length) {
        toast.error(`Не удалось удалить: ${json.failed.length}`)
      }
      setUsage(null)
      onClear()
      router.refresh()
    } finally { setBusy(false) }
  }

  const hard = usage?.filter(u => u.mode === 'hard') ?? []
  const soft = usage?.filter(u => u.mode === 'soft') ?? []
  const withLinks = usage?.filter(u => u.assignments > 0 || u.roadmap_items > 0) ?? []

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <span className="text-sm">
          Выбрано: <b>{selectedIds.length}</b>
        </span>
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
          Удалить выбранное
        </Button>
      </div>

      <AlertDialog open={usage !== null} onOpenChange={(v) => { if (!v && !busy) setUsage(null) }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить {selectedIds.length} {label}(-й)?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                {soft.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                    <div className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
                      <Archive className="h-4 w-4" />
                      Будут скрыты, результаты сохранятся: {soft.length}
                    </div>
                    <ul className="mt-1.5 space-y-0.5 text-amber-800/90 dark:text-amber-200/80">
                      {soft.slice(0, 5).map(u => (
                        <li key={u.test_id} className="truncate">
                          «{u.title}» — решали {u.attempts} чел.
                        </li>
                      ))}
                      {soft.length > 5 && <li>…и ещё {soft.length - 5}</li>}
                    </ul>
                    <p className="mt-1.5 text-xs text-amber-800/80 dark:text-amber-200/70">
                      Эти тесты исчезнут из списков, но попытки и баллы учеников останутся —
                      иначе статистика стала бы неполной.
                    </p>
                  </div>
                )}

                {hard.length > 0 && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                    <div className="flex items-center gap-2 font-medium text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      Будут удалены безвозвратно: {hard.length}
                    </div>
                    <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
                      {hard.slice(0, 5).map(u => (
                        <li key={u.test_id} className="truncate">«{u.title}»</li>
                      ))}
                      {hard.length > 5 && <li>…и ещё {hard.length - 5}</li>}
                    </ul>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Их никто не решал — удаляются вместе с заданиями, картинками и разборами.
                    </p>
                  </div>
                )}

                {withLinks.length > 0 && (
                  <div className="rounded-md border p-3">
                    <div className="font-medium">Затронутые связи</div>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      {withLinks.slice(0, 5).map(u => (
                        <li key={u.test_id} className="truncate">
                          «{u.title}»: назначений {u.assignments}
                          {u.roadmap_items > 0 && `, в программах ${u.roadmap_items}`}
                        </li>
                      ))}
                      {withLinks.length > 5 && <li>…и ещё {withLinks.length - 5}</li>}
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
