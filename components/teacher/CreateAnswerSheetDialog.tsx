'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FileText, Loader2, Upload, X } from 'lucide-react'

interface ScoringRule {
  id: string
  name: string
  scoring_rule_items: { task_number: number; max_score: number }[]
}

interface Row { max_score: string; answer: string }

const MAX_FILES = 5
const MAX_FILE_BYTES = 50 * 1024 * 1024 // лимит бакета test-documents

const emptyRows = (n: number): Row[] => Array.from({ length: n }, () => ({ max_score: '1', answer: '' }))

// Создание работы по PDF — бланка ответов (tests.answer_sheet, миграция 116):
// файлы работы + число заданий с баллами (+ необязательный ключ). Файлы
// браузер кладёт в test-documents сам (тело запроса к функции Vercel
// ограничено ~4.5 МБ), роут /api/tests/answer-sheet получает только пути.
export function CreateAnswerSheetDialog({
  open, onClose, onCreated, defaultKind = 'test', defaultSubject,
}: {
  open: boolean
  onClose: () => void
  onCreated: (test: { id: string; title: string }) => void
  defaultKind?: 'test' | 'homework'
  defaultSubject?: string | null
}) {
  const [title, setTitle] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [rows, setRows] = useState<Row[]>(emptyRows(10))
  const [count, setCount] = useState('10')
  const [rules, setRules] = useState<ScoringRule[]>([])
  const [ruleId, setRuleId] = useState<string>('none')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch('/api/scoring-rules')
      .then(r => (r.ok ? r.json() : []))
      .then((d: ScoringRule[]) => { if (!cancelled) setRules(Array.isArray(d) ? d : []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open])

  function applyCount(v: string) {
    setCount(v)
    const n = Math.min(100, Math.max(0, Math.floor(Number(v) || 0)))
    if (n < 1) return
    setRows(prev => n <= prev.length ? prev.slice(0, n) : [...prev, ...emptyRows(n - prev.length)])
  }

  // Разбалловка из «Правил оценивания» (ОГЭ/ЕГЭ/ВПР) — баллы по номерам
  function applyRule(id: string) {
    setRuleId(id)
    const rule = rules.find(r => r.id === id)
    if (!rule?.scoring_rule_items.length) return
    const items = [...rule.scoring_rule_items].sort((a, b) => a.task_number - b.task_number)
    const n = items[items.length - 1].task_number
    const byNumber = new Map(items.map(i => [i.task_number, i.max_score]))
    setRows(prev => Array.from({ length: n }, (_, i) => ({
      max_score: String(byNumber.get(i + 1) ?? 1),
      answer: prev[i]?.answer ?? '',
    })))
    setCount(String(n))
  }

  function addFiles(list: FileList | null) {
    if (!list) return
    const picked = [...list].filter(f => {
      if (f.type !== 'application/pdf') { toast.error(`«${f.name}» — не PDF`); return false }
      if (f.size > MAX_FILE_BYTES) { toast.error(`«${f.name}» больше 50 МБ`); return false }
      return true
    })
    setFiles(prev => [...prev, ...picked].slice(0, MAX_FILES))
  }

  const scores = rows.map(r => Number(r.max_score.replace(',', '.')))
  const scoresValid = scores.every(s => Number.isFinite(s) && s > 0 && s <= 100)
  const total = scoresValid ? scores.reduce((a, b) => a + b, 0) : null
  const canSave = title.trim().length > 0 && files.length > 0 && rows.length > 0 && scoresValid && !busy

  async function save() {
    if (!canSave) return
    setBusy(true)
    try {
      // Имя объекта — только номер: ключи хранилища не принимают кириллицу и
      // часть символов; исходное имя файла уходит в test_documents
      const folder = `answer-sheets/${crypto.randomUUID()}`
      const supabase = createClient()
      const uploaded: { path: string; name: string }[] = []
      for (const [i, f] of files.entries()) {
        const path = `${folder}/${i + 1}.pdf`
        const { error } = await supabase.storage.from('test-documents')
          .upload(path, f, { contentType: 'application/pdf', upsert: false })
        if (error) { toast.error(`Не удалось загрузить «${f.name}»: ${error.message}`); return }
        uploaded.push({ path, name: f.name })
      }

      const res = await fetch('/api/tests/answer-sheet', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          subject: defaultSubject ?? null,
          kind: defaultKind,
          scoring_rule_id: ruleId !== 'none' ? ruleId : null,
          tasks: rows.map((r, i) => ({ max_score: scores[i], answer: r.answer.trim() || null })),
          files: uploaded,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Не удалось создать работу'); return }
      toast.success('Работа создана')
      onCreated({ id: json.test_id, title: json.title })
      setTitle(''); setFiles([]); setRows(emptyRows(10)); setCount('10'); setRuleId('none')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Новая работа по PDF</DialogTitle>
          <DialogDescription>
            Ученик смотрит файл работы и вписывает только ответы, к работе можно приложить до 3 фото решения.
            Задания с ответом проверятся автоматически, без ответа — уйдут вам на проверку.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 min-w-0">
          <div className="space-y-1">
            <Label htmlFor="as-title">Название</Label>
            <Input id="as-title" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Контрольная работа №3, вариант 1" />
          </div>

          <div className="space-y-1.5">
            <Label>Файлы работы (PDF, до {MAX_FILES})</Label>
            {files.length > 0 && (
              <ul className="space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm rounded border px-2 py-1">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate flex-1 min-w-0">{f.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{(f.size / 1024 / 1024).toFixed(1)} МБ</span>
                    <button type="button" className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Убрать ${f.name}`} onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {files.length < MAX_FILES && (
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1.5" /> Выбрать PDF
              </Button>
            )}
            <input ref={fileRef} type="file" accept="application/pdf" multiple className="hidden"
              onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="as-count">Заданий</Label>
              <Input id="as-count" type="number" min={1} max={100} value={count}
                onChange={(e) => applyCount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Баллы из правила</Label>
              <Select value={ruleId} onValueChange={applyRule}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— задать вручную —</SelectItem>
                  {rules.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label>Баллы и ответы</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {total != null ? `всего ${total} б.` : 'балл — число от 0 до 100'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Ответ необязателен. Несколько верных вариантов — через «|», например <code>14|41</code>.
            </p>
            <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1">
                  <span className="w-9 shrink-0 text-sm tabular-nums text-muted-foreground">№{i + 1}</span>
                  <Input aria-label={`Балл за задание ${i + 1}`} inputMode="decimal"
                    className="h-8 w-16 shrink-0 text-center" value={r.max_score}
                    onChange={(e) => setRows(prev => prev.map((x, j) => j === i ? { ...x, max_score: e.target.value } : x))} />
                  <Input aria-label={`Ответ на задание ${i + 1}`} placeholder="ответ (необязательно)"
                    className="h-8 flex-1 min-w-0" value={r.answer}
                    onChange={(e) => setRows(prev => prev.map((x, j) => j === i ? { ...x, answer: e.target.value } : x))} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button onClick={save} disabled={!canSave}>
            {busy ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Создание…</> : 'Создать работу'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
