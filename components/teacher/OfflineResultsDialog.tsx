'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Task { id: string; task_number: number; max_score: number }
interface StudentRow {
  id: string
  full_name: string
  absent: boolean
  scores: Record<string, number> | null
  online: { status: string; score: number | null; max_score: number | null; submitted_at: string | null } | null
}
interface Data {
  assignment: { id: string; title: string; conducted_on: string | null; ends_at: string | null; makeup: boolean }
  tasks: Task[]
  students: StudentRow[]
}

// Ячейки храним строками: учитель печатает «1,5», стирает, вставляет из
// Excel — число получаем только при проверке и сохранении.
type Cells = Record<string, Record<string, string>>

function parseCell(v: string): number | null | 'invalid' {
  const t = v.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : 'invalid'
}

const ONLINE_STATUS: Record<string, string> = {
  in_progress: 'пишет онлайн',
  not_started: 'пишет онлайн',
  submitted: 'сдал онлайн, на проверке',
  checked: 'сдал онлайн',
}

// Таблица результатов очной работы (миграция 116): ученики программы ×
// задания теста. Баллы пишутся обычной попыткой ученика — см.
// app/api/assignments/[id]/offline-results. «Не был» открывает ученику тест
// на сайте (кроме работы «только баллы», 117 — там это просто «н»); кто уже писал онлайн — показан результатом, без правки.
export function OfflineResultsDialog({
  assignmentId, onClose,
}: {
  assignmentId: string | null
  onClose: () => void
}) {
  const router = useRouter()
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cells, setCells] = useState<Cells>({})
  const [absent, setAbsent] = useState<Set<string>>(new Set())
  const [conductedOn, setConductedOn] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const tableRef = useRef<HTMLTableElement>(null)

  useEffect(() => {
    if (!assignmentId) return
    // Состояние другого назначения сюда не переносится: родитель монтирует
    // диалог заново по key={assignmentId}
    let cancelled = false
    fetch(`/api/assignments/${assignmentId}/offline-results`)
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error ?? 'Не удалось загрузить результаты')
        return j as Data
      })
      .then(d => {
        if (cancelled) return
        const c: Cells = {}
        for (const s of d.students) {
          c[s.id] = {}
          for (const t of d.tasks) {
            const v = s.scores?.[t.id]
            c[s.id][t.id] = v == null ? '' : String(v).replace('.', ',')
          }
        }
        setCells(c)
        setAbsent(new Set(d.students.filter(s => s.absent).map(s => s.id)))
        setConductedOn(d.assignment.conducted_on ?? '')
        setData(d)
      })
      .catch(e => { if (!cancelled) setLoadError(e.message) })
    return () => { cancelled = true }
  }, [assignmentId])

  const editable = useMemo(() => (data?.students ?? []).filter(s => !s.online), [data])

  // Ошибки ячеек: не число или вне 0..max — подсветка и запрет сохранения
  const invalid = useMemo(() => {
    const bad = new Set<string>()
    if (!data) return bad
    for (const s of editable) {
      if (absent.has(s.id)) continue
      for (const t of data.tasks) {
        const v = parseCell(cells[s.id]?.[t.id] ?? '')
        if (v === 'invalid' || (v != null && (v < 0 || v > t.max_score))) bad.add(`${s.id}:${t.id}`)
      }
    }
    return bad
  }, [data, editable, cells, absent])

  function setCell(studentId: string, taskId: string, value: string) {
    setCells(prev => ({ ...prev, [studentId]: { ...prev[studentId], [taskId]: value } }))
    setDirty(true)
  }

  function toggleAbsent(studentId: string) {
    setAbsent(prev => {
      const n = new Set(prev)
      if (n.has(studentId)) n.delete(studentId); else n.add(studentId)
      return n
    })
    setDirty(true)
  }

  // Вставка блока из Excel/Google Таблиц (строки через \n, ячейки через \t)
  // начиная с ячейки, в которую вставили. Одиночное значение — обычная вставка.
  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>, rowIdx: number, colIdx: number) {
    if (!data) return
    const text = e.clipboardData.getData('text')
    if (!/[\t\n]/.test(text.trim())) return
    e.preventDefault()
    const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n')
    setCells(prev => {
      const next = { ...prev }
      lines.forEach((line, i) => {
        const s = editable[rowIdx + i]
        if (!s || absent.has(s.id)) return
        next[s.id] = { ...next[s.id] }
        line.split('\t').forEach((v, j) => {
          const t = data.tasks[colIdx + j]
          if (t) next[s.id][t.id] = v.trim()
        })
      })
      return next
    })
    setDirty(true)
  }

  // Enter — вниз по столбцу (как в таблицах), Tab — вправо (по умолчанию)
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number, colIdx: number) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const target = tableRef.current?.querySelector<HTMLInputElement>(
      `input[data-row="${rowIdx + (e.shiftKey ? -1 : 1)}"][data-col="${colIdx}"]`
    )
    target?.focus()
    target?.select()
  }

  function rowTotal(studentId: string): number | null {
    if (!data) return null
    let sum = 0, any = false
    for (const t of data.tasks) {
      const v = parseCell(cells[studentId]?.[t.id] ?? '')
      if (typeof v === 'number') { sum += v; any = true }
    }
    return any ? sum : null
  }

  function requestClose() {
    if (dirty && !window.confirm('Результаты не сохранены. Закрыть без сохранения?')) return
    onClose()
  }

  async function save() {
    if (!data || !assignmentId) return
    if (invalid.size > 0) { toast.error('Исправьте подсвеченные баллы'); return }
    if (!conductedOn) { toast.error('Укажите дату проведения'); return }
    setSaving(true)
    try {
      const rows = editable.map(s => ({
        student_id: s.id,
        absent: absent.has(s.id),
        scores: Object.fromEntries(data.tasks.map(t => {
          const v = parseCell(cells[s.id]?.[t.id] ?? '')
          return [t.id, typeof v === 'number' ? v : null]
        })),
      }))
      const res = await fetch(`/api/assignments/${assignmentId}/offline-results`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conducted_on: conductedOn, rows }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Не удалось сохранить'); return }
      if (json.skipped?.length) {
        toast.warning(`Уже писали онлайн, не изменены: ${json.skipped.join(', ')}`)
      }
      toast.success('Результаты сохранены')
      setDirty(false)
      onClose()
      router.refresh()
    } finally { setSaving(false) }
  }

  const maxTotal = data?.tasks.reduce((s, t) => s + t.max_score, 0) ?? 0

  return (
    <Dialog open={!!assignmentId} onOpenChange={(v) => { if (!v) requestClose() }}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Результаты очной работы{data ? ` «${data.assignment.title}»` : ''}</DialogTitle>
          <DialogDescription>
            Баллы попадут в статистику и прогресс программы так же, как онлайн-тест.
            Пустая строка — результат не внесён.{' '}
            {data && !data.assignment.makeup
              ? '«Не был» — отметка «н», работы на сайте у неё нет.'
              : '«Не был» — ученику откроется тест на сайте.'}
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <p className="text-sm text-destructive py-4">{loadError}</p>
        ) : !data ? (
          <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
          </div>
        ) : data.tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">В тесте нет заданий.</p>
        ) : data.students.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">В программе нет учеников.</p>
        ) : (
          <div className="space-y-3 min-w-0">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="space-y-1">
                <Label htmlFor="off-date">Дата проведения</Label>
                <Input id="off-date" type="date" className="w-44" value={conductedOn}
                  onChange={(e) => { setConductedOn(e.target.value); setDirty(true) }} />
              </div>
              <p className="text-xs text-muted-foreground pb-2">
                Enter — следующий ученик, Tab — следующее задание. Можно вставить блок из Excel.
              </p>
            </div>

            {/* прокрутка — только у самой таблицы, если она шире окна */}
            <div className="overflow-x-auto rounded-md border">
              <table ref={tableRef} className="text-sm border-collapse w-max min-w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left font-medium px-3 py-2 sticky left-0 bg-muted min-w-40">Ученик</th>
                    {data.tasks.map(t => (
                      <th key={t.id} className="font-medium px-1 py-2 text-center whitespace-nowrap">
                        №{t.task_number}
                        <span className="block text-[10px] font-normal text-muted-foreground">из {t.max_score}</span>
                      </th>
                    ))}
                    <th className="font-medium px-3 py-2 text-center">Итог</th>
                    <th className="font-medium px-3 py-2 text-center whitespace-nowrap">Не был</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.students.map(s => {
                    if (s.online) {
                      return (
                        <tr key={s.id} className="bg-muted/20">
                          <td className="px-3 py-1.5 sticky left-0 bg-background font-medium">{s.full_name}</td>
                          <td colSpan={data.tasks.length + 2} className="px-3 py-1.5 text-xs text-muted-foreground">
                            {ONLINE_STATUS[s.online.status] ?? 'писал онлайн'}
                            {s.online.status === 'checked' && s.online.score != null
                              ? `: ${s.online.score}/${s.online.max_score ?? maxTotal}` : ''}
                            {s.online.submitted_at
                              ? ` · ${new Date(s.online.submitted_at).toLocaleDateString('ru-RU')}` : ''}
                          </td>
                        </tr>
                      )
                    }
                    const rowIdx = editable.indexOf(s)
                    const isAbsent = absent.has(s.id)
                    const total = rowTotal(s.id)
                    return (
                      <tr key={s.id} className={cn(isAbsent && 'bg-muted/30')}>
                        <td className="px-3 py-1.5 sticky left-0 bg-background font-medium">{s.full_name}</td>
                        {data.tasks.map((t, colIdx) => (
                          <td key={t.id} className="px-0.5 py-1 text-center">
                            {isAbsent ? (
                              <span className="text-muted-foreground">·</span>
                            ) : (
                              <input
                                data-row={rowIdx} data-col={colIdx}
                                inputMode="decimal"
                                aria-label={`${s.full_name}, задание ${t.task_number}`}
                                className={cn(
                                  'w-11 h-8 rounded border bg-background text-center tabular-nums outline-none focus:ring-2 focus:ring-ring',
                                  invalid.has(`${s.id}:${t.id}`) && 'border-destructive bg-destructive/10',
                                )}
                                value={cells[s.id]?.[t.id] ?? ''}
                                onChange={(e) => setCell(s.id, t.id, e.target.value)}
                                onPaste={(e) => handlePaste(e, rowIdx, colIdx)}
                                onKeyDown={(e) => handleKeyDown(e, rowIdx, colIdx)}
                                onFocus={(e) => e.target.select()}
                              />
                            )}
                          </td>
                        ))}
                        <td className="px-3 py-1.5 text-center tabular-nums whitespace-nowrap">
                          {isAbsent ? <span className="font-medium">н</span> : total != null ? `${total}/${maxTotal}` : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <input type="checkbox" className="h-4 w-4" checked={isAbsent}
                            aria-label={`${s.full_name} отсутствовал`}
                            onChange={() => toggleAbsent(s.id)} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={requestClose} disabled={saving}>Отмена</Button>
          <Button onClick={save} disabled={saving || !data || invalid.size > 0}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
