'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Plus, ClipboardList } from 'lucide-react'
import { DeleteAssignmentButton } from '@/components/teacher/DeleteAssignmentButton'
import { ProgramSummaryTable } from '@/components/teacher/ProgramSummaryTable'
import { ProgramDetailSheet } from '@/components/teacher/ProgramDetailSheet'
import type { ProgramSummaryRow } from '@/lib/roadmaps/progress'

export interface AssignmentRow {
  id: string
  test_title: string
  target: string
  starts_at: string | null
  ends_at: string | null
  created_at: string | null
  is_group: boolean
  max_attempts: number
  completed_count: number
  is_completed: boolean
  last_result: string | null
  kind: 'test' | 'homework'
}

type TypeFilter = 'all' | 'test' | 'homework' | 'programs'

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('ru-RU') : '—'
}

// «Начало → Конец» одной ячейкой; если обе пусты — прочерк, если одна — она
function fmtRange(from: string | null, to: string | null) {
  if (!from && !to) return '—'
  return `${fmtDate(from)} — ${fmtDate(to)}`
}

// Таблица назначений — первый таб мониторинга (перенесена из /teacher/assignments).
// Roadmap-назначения не смешиваются со строками обычных назначений (разная
// форма данных — сводка программы vs конкретное назначение), а доступны через
// фильтр «Программы»: сводная строка на программу → клик → ProgramDetailSheet
// с полной детализацией. Так не плодим табы и не грузим тяжёлую детализацию
// для всех программ сразу.
export function AssignmentsPanel({
  rows, programSummaries = [], isAdmin = false,
}: {
  rows: AssignmentRow[]
  programSummaries?: ProgramSummaryRow[]
  isAdmin?: boolean
}) {
  const [filter, setFilter] = useState<TypeFilter>('all')
  const [openRoadmapId, setOpenRoadmapId] = useState<string | null>(null)

  const filteredRows = useMemo(
    () => filter === 'all' ? rows : filter === 'programs' ? [] : rows.filter(r => r.kind === filter),
    [rows, filter],
  )

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Select value={filter} onValueChange={(v) => setFilter(v as TypeFilter)}>
          <SelectTrigger className="h-8 text-sm w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все назначения</SelectItem>
            <SelectItem value="test">Тесты</SelectItem>
            <SelectItem value="homework">Домашние задания</SelectItem>
            <SelectItem value="programs">Программы{programSummaries.length > 0 ? ` (${programSummaries.length})` : ''}</SelectItem>
          </SelectContent>
        </Select>
        {filter !== 'programs' && (
          <Button asChild size="sm">
            <Link href="/teacher/assignments/new">
              <Plus className="h-4 w-4 mr-2" />
              Назначить тест
            </Link>
          </Button>
        )}
      </div>

      {filter === 'programs' ? (
        <ProgramSummaryTable rows={programSummaries} isAdmin={isAdmin} onOpen={setOpenRoadmapId} />
      ) : (
        <div className="space-y-5">
          {/* «Все» показывает программы тоже — отдельным блоком сверху,
              а не только через переключение фильтра на «Программы» */}
          {filter === 'all' && programSummaries.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Программы</h3>
              <ProgramSummaryTable rows={programSummaries} isAdmin={isAdmin} onOpen={setOpenRoadmapId} />
            </div>
          )}

          {!(filter === 'all' && programSummaries.length > 0 && filteredRows.length === 0) && (
            <div className="space-y-2">
              {filter === 'all' && programSummaries.length > 0 && (
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Остальные назначения</h3>
              )}
              {filteredRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
                  <ClipboardList className="h-10 w-10 opacity-40" />
                  <p>Нет назначений. Назначьте тест группе или ученику.</p>
                </div>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-4 py-3 font-medium">Тест</th>
                          <th className="text-left px-4 py-3 font-medium">Для кого</th>
                          <th className="text-left px-4 py-3 font-medium">Сроки</th>
                          <th className="text-left px-4 py-3 font-medium">Попыток</th>
                          <th className="text-left px-4 py-3 font-medium">Создано</th>
                          <th className="px-4 py-3" />
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {filteredRows.map(a => (
                          <tr key={a.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 font-medium">{a.test_title}</td>
                            <td className="px-4 py-3 text-muted-foreground">{a.target}</td>
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtRange(a.starts_at, a.ends_at)}</td>
                            <td className="px-4 py-3">
                              {a.is_group ? (
                                <span className="text-muted-foreground">{a.max_attempts} / уч.</span>
                              ) : (
                                <div className="space-y-0.5">
                                  {a.is_completed
                                    ? <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">✓ Завершён ({a.completed_count}/{a.max_attempts})</span>
                                    : <span className="text-muted-foreground">использовано {a.completed_count} из {a.max_attempts}</span>
                                  }
                                  {a.last_result && (
                                    <div className="text-[11px] text-muted-foreground">последняя: <span className="font-medium tabular-nums text-foreground">{a.last_result}</span></div>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{fmtDate(a.created_at)}</td>
                            <td className="px-4 py-3">
                              <DeleteAssignmentButton assignmentId={a.id} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ProgramDetailSheet roadmapId={openRoadmapId} onClose={() => setOpenRoadmapId(null)} />
    </>
  )
}
