'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { StatusChip } from '@/components/shared/StatusChip'
import { closedReasonLabel } from '@/lib/assignments/completion'
import { Loader2 } from 'lucide-react'

interface StudentStat {
  id: string
  full_name: string
  status: string
  score: number | null
  max_score: number | null
  attempt_id: string | null
  attempts_used: number
  closed_reason: string | null
}

interface AssignmentStats {
  id: string
  title: string
  kind: 'homework' | 'test'
  created_at: string | null
  starts_at: string | null
  ends_at: string | null
  max_attempts: number
  is_group: boolean
  students: StudentStat[]
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Модалка статистики одного назначения — вызывается иконкой рядом с заданием
// в RoadmapEditor. Лёгкий GET по assignment_id (app/api/assignments/[id]/stats),
// не весь прогресс программы — иначе клик по одной иконке тянул бы данные по
// всем темам и ученикам программы сразу.
export function AssignmentStatsModal({ assignmentId, onClose }: { assignmentId: string | null; onClose: () => void }) {
  const [stats, setStats] = useState<AssignmentStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // assignmentId=null — модалка закрыта (Dialog open={!!assignmentId}),
    // старые stats молча остаются в state до следующего открытия — тот же
    // приём, что в TestPreviewModalById, не стоит сбрасывать синхронно здесь.
    if (!assignmentId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/assignments/${assignmentId}/stats`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? 'Не удалось загрузить статистику')
        return data as AssignmentStats
      })
      .then(data => { if (!cancelled) setStats(data) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка загрузки') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [assignmentId])

  const doneCount = stats?.students.filter(s => s.status === 'checked').length ?? 0

  return (
    <Dialog open={!!assignmentId} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {stats && (
              <Badge variant={stats.kind === 'homework' ? 'outline' : 'secondary'} className="text-[11px]">
                {stats.kind === 'homework' ? 'ДЗ' : 'Тест'}
              </Badge>
            )}
            <span className="truncate">{stats?.title ?? 'Статистика назначения'}</span>
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {error && <p className="text-sm text-destructive py-4">{error}</p>}

        {stats && !loading && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Создано</dt>
              <dd>{formatDateTime(stats.created_at)}</dd>
              <dt className="text-muted-foreground">Открыто с</dt>
              <dd>{formatDateTime(stats.starts_at)}</dd>
              <dt className="text-muted-foreground">Дедлайн</dt>
              <dd>{formatDateTime(stats.ends_at)}</dd>
              <dt className="text-muted-foreground">Попыток разрешено</dt>
              <dd>{stats.max_attempts}</dd>
            </dl>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Ученики — решили {doneCount}/{stats.students.length}
              </p>
              {stats.students.length === 0 ? (
                <p className="text-sm text-muted-foreground">Назначение не адресовано ни одному ученику.</p>
              ) : (
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {stats.students.map(s => (
                    <div key={s.id} className="flex items-center justify-between gap-2 text-sm rounded px-2 py-1.5 bg-muted/30">
                      <span className="truncate">{s.full_name}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        {s.score !== null && (
                          <span className="text-xs font-medium tabular-nums text-muted-foreground">
                            {s.score}/{s.max_score ?? '?'}
                          </span>
                        )}
                        {stats.max_attempts > 1 && (
                          <span className="text-[11px] text-muted-foreground/70">
                            {s.attempts_used}/{stats.max_attempts}
                          </span>
                        )}
                        {closedReasonLabel(s.closed_reason) && (
                          <span
                            className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
                            title={`Завершено: ${closedReasonLabel(s.closed_reason)}`}
                          >
                            ✓
                          </span>
                        )}
                        <StatusChip status={s.status} />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
