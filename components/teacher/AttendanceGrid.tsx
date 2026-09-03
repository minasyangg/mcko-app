'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Trash2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type MarkStatus = 'present' | 'absent' | 'sick' | 'holiday'

export interface JournalStudent {
  id: string
  student_id: string | null
  full_name: string
  sort_order: number
}
export interface JournalDay {
  id: string
  day: string
  note: string | null
}
export interface JournalMark {
  student_id: string
  day_id: string
  status: MarkStatus
}

// Порядок перебора по клику: пусто → + → н → б → вых → пусто.
// «+» первым, потому что присутствие — самый частый исход, до него должен
// быть один клик.
const CYCLE: (MarkStatus | null)[] = ['present', 'absent', 'sick', 'holiday', null]

export const MARK_LABEL: Record<MarkStatus, string> = {
  present: '+',
  absent: 'н',
  sick: 'б',
  holiday: 'вых',
}

const MARK_CLASS: Record<MarkStatus, string> = {
  present: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  absent: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  sick: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  holiday: 'bg-muted text-muted-foreground',
}

const WEEKDAY_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

function parseISO(day: string) {
  return new Date(`${day}T00:00:00Z`)
}
function fmtDay(day: string) {
  const d = parseISO(day)
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function weekdayOf(day: string) {
  return WEEKDAY_SHORT[parseISO(day).getUTCDay()]
}
function isWeekend(day: string) {
  const d = parseISO(day).getUTCDay()
  return d === 0 || d === 6
}

interface Props {
  journalId: string
  students: JournalStudent[]
  days: JournalDay[]
  marks: JournalMark[]
  onChanged: () => void
  onRemoveStudent: (rowId: string) => void
  onRemoveDay: (dayId: string) => void
}

export function AttendanceGrid({
  journalId, students, days, marks, onChanged, onRemoveStudent, onRemoveDay,
}: Props) {
  // Локальная копия отметок: клики должны отзываться мгновенно, а сеть —
  // догонять. При ошибке сохранения откатываемся и перечитываем с сервера.
  const [local, setLocal] = useState<Map<string, MarkStatus>>(
    () => new Map(marks.map(m => [`${m.student_id}|${m.day_id}`, m.status])),
  )
  const [saving, setSaving] = useState(false)

  // marks приходят с сервера после каждого onChanged — пересобираем, если
  // изменился их состав (добавили день/ученика, применили массовое действие)
  const marksKey = useMemo(
    () => marks.map(m => `${m.student_id}|${m.day_id}|${m.status}`).sort().join(','),
    [marks],
  )
  const [syncedKey, setSyncedKey] = useState(marksKey)
  if (marksKey !== syncedKey) {
    setLocal(new Map(marks.map(m => [`${m.student_id}|${m.day_id}`, m.status])))
    setSyncedKey(marksKey)
  }

  const key = (s: string, d: string) => `${s}|${d}`

  async function save(batch: { student_id: string; day_id: string; status: MarkStatus | null }[]) {
    setSaving(true)
    try {
      const res = await fetch(`/api/attendance/${journalId}/marks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marks: batch }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(json.error ?? 'Не удалось сохранить')
        onChanged() // перечитать: локальное состояние могло разойтись с БД
        return
      }
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  function cycleCell(studentRowId: string, dayId: string) {
    const cur = local.get(key(studentRowId, dayId)) ?? null
    const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length]

    setLocal(prev => {
      const n = new Map(prev)
      if (next === null) n.delete(key(studentRowId, dayId))
      else n.set(key(studentRowId, dayId), next)
      return n
    })
    save([{ student_id: studentRowId, day_id: dayId, status: next }])
  }

  // Проставить всей колонке (дню) один статус — «весь день выходной»
  function fillDay(dayId: string, status: MarkStatus | null) {
    setLocal(prev => {
      const n = new Map(prev)
      for (const s of students) {
        if (status === null) n.delete(key(s.id, dayId))
        else n.set(key(s.id, dayId), status)
      }
      return n
    })
    save(students.map(s => ({ student_id: s.id, day_id: dayId, status })))
  }

  if (students.length === 0 || days.length === 0) {
    return (
      <div className="rounded-md border py-12 text-center text-sm text-muted-foreground">
        {students.length === 0 && days.length === 0
          ? 'Добавьте учеников и учебные дни — появится таблица.'
          : students.length === 0
            ? 'Добавьте учеников.'
            : 'Добавьте учебные дни.'}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>Клик по клетке меняет отметку:</span>
        {(['present', 'absent', 'sick', 'holiday'] as MarkStatus[]).map(s => (
          <span key={s} className={cn('rounded px-1.5 py-0.5 font-medium', MARK_CLASS[s])}>
            {MARK_LABEL[s]}
          </span>
        ))}
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      </div>

      {/* Таблица шире экрана — скроллится сама, страница по горизонтали не едет */}
      <div className="overflow-x-auto rounded-md border">
        <table className="text-sm border-collapse">
          <thead>
            <tr className="border-b bg-muted/50">
              {/* Липкая колонка с ФИО: при длинном списке дат имя остаётся видно */}
              <th className="sticky left-0 z-10 min-w-44 border-r bg-muted/50 px-3 py-2 text-left font-medium text-muted-foreground">
                Ученик
              </th>
              {days.map(d => (
                <th key={d.id} className={cn(
                  'min-w-14 px-1 py-1.5 text-center font-medium',
                  isWeekend(d.day) ? 'text-muted-foreground/70' : 'text-muted-foreground',
                )}>
                  <div className="tabular-nums">{fmtDay(d.day)}</div>
                  <div className="text-[10px] font-normal opacity-70">{weekdayOf(d.day)}</div>
                  <div className="mt-0.5 flex items-center justify-center gap-0.5">
                    {/* Быстрое «весь день выходной» — типовой случай каникул */}
                    <button
                      type="button"
                      onClick={() => fillDay(d.id, 'holiday')}
                      title="Отметить весь день как выходной"
                      className="rounded px-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      вых
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveDay(d.id)}
                      title="Удалить день"
                      className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </th>
              ))}
              <th className="px-2" />
            </tr>
          </thead>
          <tbody>
            {students.map(s => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="sticky left-0 z-10 border-r bg-background px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate" title={s.full_name}>{s.full_name}</span>
                    {!s.student_id && (
                      <span className="shrink-0 text-[10px] text-muted-foreground" title="Нет учётной записи на сайте">
                        вне сайта
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemoveStudent(s.id)}
                      title="Убрать из журнала"
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </td>
                {days.map(d => {
                  const st = local.get(key(s.id, d.id)) ?? null
                  return (
                    <td key={d.id} className="p-0.5 text-center">
                      <button
                        type="button"
                        onClick={() => cycleCell(s.id, d.id)}
                        className={cn(
                          'h-7 w-full min-w-12 rounded text-xs font-medium transition-colors',
                          st ? MARK_CLASS[st] : 'hover:bg-muted',
                          !st && isWeekend(d.day) && 'bg-muted/40',
                        )}
                      >
                        {st ? MARK_LABEL[st] : ''}
                      </button>
                    </td>
                  )
                })}
                <td className="px-2" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AttendanceSummary students={students} days={days} local={local} />
    </div>
  )
}

// Итоги по каждому ученику: сколько был, пропустил, болел. «вых» в знаменатель
// не идёт — это не учебный день, и включать его в статистику посещаемости
// значило бы занижать её у всех разом.
function AttendanceSummary({
  students, days, local,
}: {
  students: JournalStudent[]
  days: JournalDay[]
  local: Map<string, MarkStatus>
}) {
  const rows = students.map(s => {
    let present = 0, absent = 0, sick = 0
    for (const d of days) {
      const st = local.get(`${s.id}|${d.id}`)
      if (st === 'present') present++
      else if (st === 'absent') absent++
      else if (st === 'sick') sick++
    }
    const base = present + absent + sick
    return {
      id: s.id,
      name: s.full_name,
      present, absent, sick,
      pct: base > 0 ? Math.round((present / base) * 100) : null,
    }
  })

  return (
    <details className="rounded-md border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Итоги посещаемости</summary>
      <div className="overflow-x-auto border-t">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-left">
              <th className="px-3 py-1.5 font-medium text-muted-foreground">Ученик</th>
              <th className="px-3 py-1.5 text-center font-medium text-muted-foreground">Был</th>
              <th className="px-3 py-1.5 text-center font-medium text-muted-foreground">Не был</th>
              <th className="px-3 py-1.5 text-center font-medium text-muted-foreground">Болел</th>
              <th className="px-3 py-1.5 text-center font-medium text-muted-foreground">Посещаемость</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="px-3 py-1.5">{r.name}</td>
                <td className="px-3 py-1.5 text-center tabular-nums">{r.present}</td>
                <td className="px-3 py-1.5 text-center tabular-nums">{r.absent}</td>
                <td className="px-3 py-1.5 text-center tabular-nums">{r.sick}</td>
                <td className="px-3 py-1.5 text-center tabular-nums font-medium">
                  {r.pct === null ? '—' : `${r.pct}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
