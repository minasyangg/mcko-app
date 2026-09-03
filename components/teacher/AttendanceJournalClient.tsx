'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { ArrowLeft, CalendarPlus, UserPlus, Loader2 } from 'lucide-react'
import {
  AttendanceGrid, type JournalStudent, type JournalDay, type JournalMark,
} from '@/components/teacher/AttendanceGrid'

interface StudentOption { id: string; full_name: string; grade: string | null }

const WEEKDAYS = [
  { v: 1, label: 'Пн' }, { v: 2, label: 'Вт' }, { v: 3, label: 'Ср' },
  { v: 4, label: 'Чт' }, { v: 5, label: 'Пт' }, { v: 6, label: 'Сб' }, { v: 0, label: 'Вс' },
]

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function AttendanceJournalClient({
  journalId, title, subject, availableStudents,
}: {
  journalId: string
  title: string
  subject: string | null
  availableStudents: StudentOption[]
}) {
  const [students, setStudents] = useState<JournalStudent[]>([])
  const [days, setDays] = useState<JournalDay[]>([])
  const [marks, setMarks] = useState<JournalMark[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const res = await fetch(`/api/attendance/${journalId}`)
    if (!res.ok) { toast.error('Не удалось загрузить журнал'); return }
    const json = await res.json()
    setStudents(json.students ?? [])
    setDays(json.days ?? [])
    setMarks(json.marks ?? [])
  }, [journalId])

  useEffect(() => { reload().finally(() => setLoading(false)) }, [reload])

  // ── Добавление учеников ──
  const [stuOpen, setStuOpen] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [manualNames, setManualNames] = useState('')
  const [busy, setBusy] = useState(false)

  const inJournal = new Set(students.map(s => s.student_id).filter(Boolean) as string[])
  const selectable = availableStudents.filter(s => !inJournal.has(s.id))

  async function addStudents() {
    const names = manualNames.split('\n').map(n => n.trim()).filter(Boolean)
    if (picked.size === 0 && names.length === 0) {
      toast.error('Выберите учеников или впишите ФИО')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/attendance/${journalId}/students`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: [...picked], names }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка'); return }
      toast.success(`Добавлено: ${json.added ?? 0}`)
      setStuOpen(false); setPicked(new Set()); setManualNames('')
      await reload()
    } finally { setBusy(false) }
  }

  // ── Добавление дней ──
  const [dayOpen, setDayOpen] = useState(false)
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set([1, 3, 5]))
  const [from, setFrom] = useState(todayISO())
  const [weeks, setWeeks] = useState(4)
  const [singleDate, setSingleDate] = useState('')

  async function addDays(payload: object, okMsg: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/attendance/${journalId}/days`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка'); return }
      toast.success(okMsg)
      setDayOpen(false)
      await reload()
    } finally { setBusy(false) }
  }

  async function removeStudent(rowId: string) {
    const res = await fetch(`/api/attendance/${journalId}/students`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row_id: rowId }),
    })
    if (!res.ok) { toast.error('Не удалось убрать ученика'); return }
    await reload()
  }

  async function removeDay(dayId: string) {
    const res = await fetch(`/api/attendance/${journalId}/days`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day_id: dayId }),
    })
    if (!res.ok) { toast.error('Не удалось убрать день'); return }
    await reload()
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Button asChild variant="ghost" size="sm" className="h-7 -ml-2 px-2 text-muted-foreground">
          <Link href="/teacher/attendance"><ArrowLeft className="h-3.5 w-3.5 mr-1" /> Все журналы</Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">{title}</h1>
            {subject && <p className="text-sm text-muted-foreground">{subject}</p>}
          </div>
          <div className="flex items-center gap-2">
            {/* Добавить учеников */}
            <Dialog open={stuOpen} onOpenChange={setStuOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <UserPlus className="h-4 w-4 mr-1.5" /> Ученики
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Добавить в журнал</DialogTitle>
                  <DialogDescription>
                    Отметьте учеников с сайта или впишите ФИО вручную — по одному в строке.
                  </DialogDescription>
                </DialogHeader>

                <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border divide-y">
                  {selectable.length === 0 && (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                      Все доступные ученики уже в журнале
                    </p>
                  )}
                  {selectable.map(s => (
                    <label key={s.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40">
                      <input
                        type="checkbox" className="h-4 w-4 shrink-0"
                        checked={picked.has(s.id)}
                        onChange={() => setPicked(prev => {
                          const n = new Set(prev)
                          if (n.has(s.id)) n.delete(s.id); else n.add(s.id)
                          return n
                        })}
                      />
                      <span className="text-sm">{s.full_name}{s.grade ? ` (${s.grade})` : ''}</span>
                    </label>
                  ))}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="manual-names">Вручную (по одному в строке)</Label>
                  <textarea
                    id="manual-names"
                    value={manualNames}
                    onChange={e => setManualNames(e.target.value)}
                    rows={3}
                    placeholder={'Иванов Иван\nПетрова Мария'}
                    className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                  />
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setStuOpen(false)} disabled={busy}>Отмена</Button>
                  <Button onClick={addStudents} disabled={busy}>
                    {busy ? 'Добавление...' : 'Добавить'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Добавить дни */}
            <Dialog open={dayOpen} onOpenChange={setDayOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <CalendarPlus className="h-4 w-4 mr-1.5" /> Учебные дни
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Добавить учебные дни</DialogTitle>
                  <DialogDescription>
                    Задайте расписание — дни повторятся на нужное число недель.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Дни недели</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAYS.map(w => (
                        <button
                          key={w.v}
                          type="button"
                          onClick={() => setWeekdays(prev => {
                            const n = new Set(prev)
                            if (n.has(w.v)) n.delete(w.v); else n.add(w.v)
                            return n
                          })}
                          className={
                            'h-8 w-10 rounded-md border text-sm transition-colors ' +
                            (weekdays.has(w.v)
                              ? 'border-primary bg-primary/10 font-medium text-primary'
                              : 'text-muted-foreground hover:bg-muted')
                          }
                        >
                          {w.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="from">Начиная с</Label>
                      <Input id="from" type="date" value={from} onChange={e => setFrom(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="weeks">Сколько недель</Label>
                      <Input
                        id="weeks" type="number" min={1} max={52} value={weeks}
                        onChange={e => setWeeks(Math.min(52, Math.max(1, Number(e.target.value) || 1)))}
                      />
                    </div>
                  </div>

                  <Button
                    className="w-full"
                    disabled={busy || weekdays.size === 0 || !from}
                    onClick={() => addDays(
                      { pattern: { weekdays: [...weekdays], from, weeks } },
                      `Расписание добавлено на ${weeks} нед.`,
                    )}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Добавить ${weekdays.size} дн. × ${weeks} нед.`}
                  </Button>

                  <div className="border-t pt-3 space-y-1">
                    <Label htmlFor="single">Или одну дату</Label>
                    <div className="flex gap-2">
                      <Input id="single" type="date" value={singleDate} onChange={e => setSingleDate(e.target.value)} />
                      <Button
                        variant="outline"
                        disabled={busy || !singleDate}
                        onClick={() => addDays({ days: [singleDate] }, 'День добавлен')}
                      >
                        Добавить
                      </Button>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <AttendanceGrid
          journalId={journalId}
          students={students}
          days={days}
          marks={marks}
          onChanged={reload}
          onRemoveStudent={removeStudent}
          onRemoveDay={removeDay}
        />
      )}
    </div>
  )
}
