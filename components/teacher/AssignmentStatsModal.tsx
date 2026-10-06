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
  receives: boolean
  personal_access: boolean
  status: string
  submitted: boolean
  score: number | null
  max_score: number | null
  attempts_used: number
  closed_reason: string | null
}

interface AssignmentStats {
  id: string
  title: string
  kind: 'homework' | 'test'
  target: string
  created_at: string | null
  starts_at: string | null
  ends_at: string | null
  max_attempts: number
  closed_at: string | null
  students: StudentStat[]
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Статистика одного назначения — открывается иконкой рядом с заданием в
// RoadmapEditor. Данные — лёгкий GET по assignment_id
// (app/api/assignments/[id]/stats), не весь прогресс программы.
export function AssignmentStatsModal({ assignmentId, onClose }: { assignmentId: string | null; onClose: () => void }) {
  // Результат привязан к id назначения: пока для текущего id ответа нет —
  // идёт загрузка, данные другого назначения не показываются
  const [result, setResult] = useState<{ id: string; stats?: AssignmentStats; error?: string } | null>(null)

  useEffect(() => {
    if (!assignmentId) return
    let cancelled = false
    fetch(`/api/assignments/${assignmentId}/stats`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? 'Не удалось загрузить статистику')
        return data as AssignmentStats
      })
      .then(stats => { if (!cancelled) setResult({ id: assignmentId, stats }) })
      .catch(e => { if (!cancelled) setResult({ id: assignmentId, error: e instanceof Error ? e.message : 'Ошибка загрузки' }) })
    return () => { cancelled = true }
  }, [assignmentId])

  const current = result && result.id === assignmentId ? result : null
  const shown = current?.stats ?? null
  const error = current?.error ?? null
  const recipients = shown?.students.filter(s => s.receives) ?? []
  const submittedCount = recipients.filter(s => s.submitted).length
  const checkedCount = recipients.filter(s => s.status === 'checked').length
  const lateJoinCount = (shown?.students.length ?? 0) - recipients.length

  return (
    <Dialog open={!!assignmentId} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            {shown && (
              <Badge variant={shown.kind === 'homework' ? 'outline' : 'secondary'} className="text-[11px] shrink-0">
                {shown.kind === 'homework' ? 'ДЗ' : 'Тест'}
              </Badge>
            )}
            <span className="truncate">{shown?.title ?? 'Статистика назначения'}</span>
          </DialogTitle>
        </DialogHeader>

        {error && <p className="text-sm text-destructive py-4">{error}</p>}

        {!shown && !error && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {shown && (
          <div className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Кому</dt>
              <dd className="min-w-0 wrap-break-word">{shown.target}</dd>
              <dt className="text-muted-foreground">Создано</dt>
              <dd>{formatDateTime(shown.created_at)}</dd>
              <dt className="text-muted-foreground">Открыто с</dt>
              <dd>{shown.starts_at ? formatDateTime(shown.starts_at) : 'сразу'}</dd>
              <dt className="text-muted-foreground">Дедлайн</dt>
              <dd>{shown.ends_at ? formatDateTime(shown.ends_at) : 'без срока'}</dd>
              <dt className="text-muted-foreground">Попыток</dt>
              <dd>{shown.max_attempts}</dd>
              {shown.closed_at && (
                <>
                  <dt className="text-muted-foreground">Статус</dt>
                  <dd className="text-emerald-700 dark:text-emerald-400">завершено учителем {formatDateTime(shown.closed_at)}</dd>
                </>
              )}
            </dl>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Сдали {submittedCount} из {recipients.length}
                {checkedCount > 0 && <span className="normal-case font-normal"> · проверено {checkedCount}</span>}
              </p>
              {shown.students.length === 0 ? (
                <p className="text-sm text-muted-foreground">В группе пока нет учеников.</p>
              ) : (
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {shown.students.map(s => (
                    <div key={s.id} className="flex items-center justify-between gap-2 text-sm rounded px-2 py-1.5 bg-muted/30">
                      <span className="min-w-0">
                        <span className={s.receives ? 'truncate block' : 'truncate block text-muted-foreground'}>{s.full_name}</span>
                        {s.personal_access && (
                          <span className="block text-[11px] text-muted-foreground">личный доступ</span>
                        )}
                      </span>
                      {s.receives ? (
                        <span className="flex items-center gap-2 shrink-0">
                          {s.score !== null && (
                            <span className="text-xs font-medium tabular-nums text-muted-foreground">
                              {s.score}/{s.max_score ?? '?'}
                            </span>
                          )}
                          {shown.max_attempts > 1 && (
                            <span className="text-[11px] text-muted-foreground/70" title="Использовано попыток">
                              {s.attempts_used}/{shown.max_attempts}
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
                      ) : (
                        <span
                          className="text-[11px] text-muted-foreground/80 shrink-0"
                          title="Ученик вступил в группу позже, чем было выдано задание, — он его не видит"
                        >
                          не выдано (вступил позже)
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {lateJoinCount > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Не выдано: {lateJoinCount} — вступили в группу позже. Открыть доступ можно в «Мониторинг → Программы».
                </p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
