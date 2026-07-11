'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Plus, ClipboardList } from 'lucide-react'
import { DeleteAssignmentButton } from '@/components/teacher/DeleteAssignmentButton'

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
}

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('ru-RU') : '—'
}

// Таблица назначений — первый таб мониторинга (перенесена из /teacher/assignments).
// Roadmap-назначения сюда не попадают: ими управляет редактор программы.
export function AssignmentsPanel({ rows }: { rows: AssignmentRow[] }) {
  return (
    <>
      <div className="flex justify-end">
        <Button asChild size="sm">
          <Link href="/teacher/assignments/new">
            <Plus className="h-4 w-4 mr-2" />
            Назначить тест
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
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
                  <th className="text-left px-4 py-3 font-medium">Начало</th>
                  <th className="text-left px-4 py-3 font-medium">Конец</th>
                  <th className="text-left px-4 py-3 font-medium">Попыток</th>
                  <th className="text-left px-4 py-3 font-medium">Создано</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(a => (
                  <tr key={a.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{a.test_title}</td>
                    <td className="px-4 py-3 text-muted-foreground">{a.target}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(a.starts_at)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(a.ends_at)}</td>
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
    </>
  )
}
