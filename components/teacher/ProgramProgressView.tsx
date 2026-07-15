'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { StatusChip } from '@/components/shared/StatusChip'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProgramDetail } from '@/lib/roadmaps/progress'

interface Props {
  program: ProgramDetail
  // readOnly=true — админ-кабинет: без кликов по ячейкам
  readOnly?: boolean
  onSelectAttempt?: (attemptId: string) => void
}

// Список учеников программы — каждый компактной строкой (ФИО + краткий итог),
// разворачивается по клику в детальную раскладку тем/заданий ЭТОГО ученика.
// Прогрессивное раскрытие вместо одной широкой таблицы «тема × ученик» —
// читаемее при нескольких темах/заданиях на тему.
export function ProgramProgressView({ program, readOnly = false, onSelectAttempt }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const allItems = program.topics.flatMap(t => t.items)
  const statusByKey = new Map(program.statuses.map(s => [`${s.assignment_id}_${s.student_id}`, s]))

  if (program.students.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">В программе пока нет учеников.</p>
  }
  if (allItems.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">К темам программы пока не привязано ни одного задания.</p>
  }

  return (
    <div className="space-y-2">
      {program.students.map(student => {
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
                          const s = statusByKey.get(`${item.assignment_id}_${student.id}`)
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
                              <span className="flex items-center gap-2 shrink-0">
                                {s && s.score !== null && (
                                  <span className="text-xs font-medium tabular-nums text-muted-foreground">
                                    {s.score}/{s.max_score ?? '?'}
                                  </span>
                                )}
                                {item.max_attempts > 1 && s && (
                                  <span className="text-[11px] text-muted-foreground/70">
                                    {s.attempts_used}/{item.max_attempts}
                                  </span>
                                )}
                                <StatusChip status={s?.status ?? 'not_started'} />
                              </span>
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
    </div>
  )
}
