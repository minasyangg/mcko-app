'use client'

import { useState } from 'react'
import { usePagination } from '@/lib/hooks/usePagination'
import { LoadMoreControl } from '@/components/shared/LoadMoreControl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/shared/StatusChip'
import { ChevronDown, ChevronRight, UserPlus, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { closedReasonLabel } from '@/lib/assignments/completion'
import { CloseAssignmentButton } from '@/components/teacher/CloseAssignmentButton'
import type { ProgramDetail } from '@/lib/roadmaps/progress'

interface Props {
  program: ProgramDetail
  // readOnly=true — админ-кабинет: без кликов по ячейкам
  readOnly?: boolean
  onSelectAttempt?: (attemptId: string) => void
  /** Рефетч после «Открыть доступ» — тот же callback, что и после оценки попытки */
  onGranted?: () => void
}

// Список учеников программы — каждый компактной строкой (ФИО + краткий итог),
// разворачивается по клику в детальную раскладку тем/заданий ЭТОГО ученика.
// Прогрессивное раскрытие вместо одной широкой таблицы «тема × ученик» —
// читаемее при нескольких темах/заданиях на тему.
export function ProgramProgressView({ program, readOnly = false, onSelectAttempt, onGranted }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [grantingKey, setGrantingKey] = useState<string | null>(null)
  // По 15 строк — список растёт с числом учеников в программе
  const { visible: pagedStudents, hasMore, loadMore, total, showing } = usePagination(program.students, 15)

  const allItems = program.topics.flatMap(t => t.items)
  const statusByKey = new Map(program.statuses.map(s => [`${s.assignment_id}_${s.student_id}`, s]))

  async function grantAccess(topicId: string, assignmentId: string, studentId: string) {
    const key = `${assignmentId}_${studentId}`
    setGrantingKey(key)
    try {
      const res = await fetch(`/api/roadmaps/${program.id}/topics/${topicId}/items/${assignmentId}/grant-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Не удалось открыть доступ'); return }
      toast.success('Доступ открыт — заданию присвоена личная попытка без общего дедлайна группы')
      onGranted?.()
    } finally {
      setGrantingKey(null)
    }
  }

  if (program.students.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">В программе пока нет учеников.</p>
  }
  if (allItems.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">К темам программы пока не привязано ни одного задания.</p>
  }

  return (
    <div className="space-y-2">
      {pagedStudents.map(student => {
        const studentStatuses = allItems
          .map(item => statusByKey.get(`${item.assignment_id}_${student.id}`))
          .filter((s): s is NonNullable<typeof s> => !!s)
        const checkedCount = studentStatuses.filter(s => s.status === 'checked').length
        const isOpen = !!expanded[student.id]

        return (
          <div key={student.id} className="rounded-md border overflow-hidden">
            <button
              type="button"
              onClick={() => setExpanded(prev => ({ ...prev, [student.id]: !prev[student.id] }))}
              className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors text-left"
            >
              <span className="flex items-center gap-2 min-w-0">
                {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                <span className="font-medium truncate">{student.full_name}</span>
              </span>
              <span className={cn(
                'text-xs font-medium shrink-0',
                checkedCount === allItems.length ? 'text-emerald-600' : 'text-muted-foreground',
              )}>
                выполнено {checkedCount}/{allItems.length}
              </span>
            </button>

            {isOpen && (
              <div className="border-t divide-y">
                {program.topics.map((topic, i) => (
                  <div key={topic.id} className="px-3 py-2.5 space-y-1.5">
                    <p className="text-sm font-medium">{i + 1}. {topic.title}</p>
                    {topic.items.length === 0 ? (
                      <p className="text-xs text-muted-foreground">заданий нет</p>
                    ) : (
                      <div className="space-y-1">
                        {topic.items.map(item => {
                          const groupStatus = statusByKey.get(`${item.assignment_id}_${student.id}`)
                          // Скрыто правилом «3 дня» (058) — ученик вступил в
                          // группу программы заметно позже, чем создано это
                          // задание, RLS ему его не показывает вовсе. Если
                          // учитель уже открыл личный доступ (кнопка ниже),
                          // берём статус ЛИЧНОЙ копии — она и есть реальный
                          // прогресс этого ученика по теме.
                          const hidden = !!groupStatus?.hiddenByLateJoin
                          const personalStatus = hidden && groupStatus?.personalAssignmentId
                            ? statusByKey.get(`${groupStatus.personalAssignmentId}_${student.id}`)
                            : undefined
                          const s = hidden ? personalStatus : groupStatus
                          const grantKey = `${item.assignment_id}_${student.id}`
                          const clickable = !readOnly && !!s?.attempt_id && onSelectAttempt
                          return (
                            <div
                              key={item.assignment_id}
                              className={cn(
                                'flex items-center justify-between gap-2 text-sm rounded px-2 py-1',
                                clickable && 'cursor-pointer hover:bg-muted/50',
                              )}
                              onClick={clickable ? () => onSelectAttempt!(s!.attempt_id!) : undefined}
                            >
                              <span className="flex items-center gap-1.5 min-w-0">
                                <Badge variant={item.kind === 'homework' ? 'outline' : 'secondary'} className="text-[11px] shrink-0">
                                  {item.kind === 'homework' ? 'ДЗ' : 'Тест'}
                                </Badge>
                                <span className="text-muted-foreground truncate">{item.title}</span>
                              </span>
                              {hidden && !s ? (
                                // Скрыто правилом «3 дня» и учитель ещё не открыл
                                // личный доступ — показываем это явно вместо
                                // молчаливого «не начато», которое выглядело бы
                                // как обычный пропуск задания учеником.
                                <span className="flex items-center gap-2 shrink-0">
                                  <span className="text-[11px] text-muted-foreground/70" title="Ученик вступил в программу после того, как это задание было выдано группе — ему оно не видно">
                                    пропущено (вступил позже)
                                  </span>
                                  {!readOnly && (
                                    <Button
                                      variant="outline" size="sm" className="h-7 text-xs"
                                      disabled={grantingKey === grantKey}
                                      onClick={(e) => { e.stopPropagation(); grantAccess(topic.id, item.assignment_id, student.id) }}
                                    >
                                      {grantingKey === grantKey
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <><UserPlus className="h-3.5 w-3.5 mr-1" />Открыть доступ</>}
                                    </Button>
                                  )}
                                </span>
                              ) : (
                                <span className="flex items-center gap-2 shrink-0">
                                  {hidden && (
                                    <span className="text-[11px] text-muted-foreground/70" title="Личная копия задания — без общего дедлайна группы, открыта учителем вручную">
                                      личный доступ
                                    </span>
                                  )}
                                  {s && s.score !== null && (
                                    <span className="text-xs font-medium tabular-nums text-muted-foreground">
                                      {s.score}/{s.max_score ?? '?'}
                                    </span>
                                  )}
                                  {item.max_attempts > 1 && !hidden && s && (
                                    <span className="text-[11px] text-muted-foreground/70">
                                      {s.attempts_used}/{item.max_attempts}
                                    </span>
                                  )}
                                  {closedReasonLabel(s?.closed_reason) && (
                                    <span
                                      className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
                                      title={`Завершено: ${closedReasonLabel(s?.closed_reason)}`}
                                    >
                                      ✓ завершено
                                    </span>
                                  )}
                                  <StatusChip status={s?.status ?? 'not_started'} />
                                  {/* stopPropagation: строка кликабельна и открывает
                                      попытку — кнопка не должна её открывать */}
                                  {!readOnly && (
                                    <span onClick={(e) => e.stopPropagation()}>
                                      <CloseAssignmentButton
                                        assignmentId={hidden ? groupStatus!.personalAssignmentId! : item.assignment_id}
                                        studentId={student.id}
                                        closedReason={s?.closed_reason ?? null}
                                        targetLabel={`Ученик ${student.full_name} по заданию «${item.title}»`}
                                        size="row"
                                      />
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
      <LoadMoreControl
        hasMore={hasMore}
        loadMore={loadMore}
        remaining={total - showing}
        step={15}
        totalLabel={total > 15 ? `Показано всего ${total} учеников` : undefined}
      />
    </div>
  )
}
