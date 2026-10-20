'use client'

import { Route, ChevronRight } from 'lucide-react'
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
      {/* Телефон: строка программы — карточка-кнопка, без 5–6 колонок */}
      <ul className="divide-y md:hidden">
        {rows.map(r => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onOpen(r.id)}
              className="flex w-full items-center gap-3 p-3 text-left transition-colors active:bg-muted/50"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium leading-snug wrap-break-word">{r.title}</p>
                <p className="text-xs text-muted-foreground">
                  {[r.subject, isAdmin ? r.owner_name : null].filter(Boolean).join(' · ') || '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Тем: {r.topic_count} · Учеников: {r.student_count}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold tabular-nums">{fmtPct(r.completion_pct)}</p>
                <p className="text-[11px] text-muted-foreground">выполнено</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto md:block">
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
