'use client'

import { Route } from 'lucide-react'
import type { ProgramSummaryRow } from '@/lib/roadmaps/progress'

function fmtPct(pct: number | null) {
  return pct === null ? '—' : `${pct}%`
}

// Сводные строки программ внутри таба «Назначения» (фильтр «Программы»).
// Клик по строке открывает ProgramDetailSheet с полной детализацией.
export function ProgramSummaryTable({
  rows, isAdmin, onOpen,
}: {
  rows: ProgramSummaryRow[]
  isAdmin: boolean
  onOpen: (roadmapId: string) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
        <Route className="h-10 w-10 opacity-40" />
        <p>{isAdmin ? 'В организации пока нет программ.' : 'У вас пока нет программ.'}</p>
      </div>
    )
  }

  return (
    <div className="rounded-md border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Программа</th>
              <th className="text-left px-4 py-3 font-medium">Предмет</th>
              {isAdmin && <th className="text-left px-4 py-3 font-medium">Учитель</th>}
              <th className="text-left px-4 py-3 font-medium">Тем</th>
              <th className="text-left px-4 py-3 font-medium">Учеников</th>
              <th className="text-left px-4 py-3 font-medium">Выполнено</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(r => (
              <tr
                key={r.id}
                className="hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => onOpen(r.id)}
              >
                <td className="px-4 py-3 font-medium">{r.title}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.subject ?? '—'}</td>
                {isAdmin && <td className="px-4 py-3 text-muted-foreground">{r.owner_name ?? '—'}</td>}
                <td className="px-4 py-3 text-muted-foreground">{r.topic_count}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.student_count}</td>
                <td className="px-4 py-3">
                  <span className="text-muted-foreground tabular-nums">{fmtPct(r.completion_pct)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
