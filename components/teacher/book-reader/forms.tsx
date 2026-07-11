'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import MarkdownContent from '@/components/shared/MarkdownContent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { taskNumberLabel } from '@/lib/books/anchors'
import { gradingMethodLabel, stripTaskNumber, type PageData, type ProblemAnchor } from './shared'

// ─── Формы редактирования читалки (по образцу EditTaskForm из тестов) ─────────

export function ProblemEditForm({
  problem, onSaved, onCancel,
}: {
  problem: ProblemAnchor
  onSaved: () => void
  onCancel: () => void
}) {
  // номер задания в форму не попадает — им управляет сервер
  const [promptMd, setPromptMd] = useState(() => stripTaskNumber(problem.prompt_md, problem.task_number))
  const [showPreview, setShowPreview] = useState(false)
  const [answer, setAnswer] = useState(problem.correct_answer?.text ?? '')
  const [gradingMethod, setGradingMethod] = useState(problem.grading_method)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/books/problems/${problem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt_md: promptMd,
          correct_answer: answer,
          grading_method: gradingMethod,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Ошибка сохранения')
        return
      }
      toast.success(`Задание ${taskNumberLabel(problem.task_number)} сохранено`)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 mt-2 pt-3 border-t" onClick={(e) => e.stopPropagation()}>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Текст задания (поддерживает LaTeX: $формула$)</Label>
          <button
            type="button"
            onClick={() => setShowPreview(v => !v)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            {showPreview ? 'Редактировать' : 'Предпросмотр'}
          </button>
        </div>
        {showPreview ? (
          <div className="min-h-24 rounded-md border bg-muted/20 px-3 py-2">
            <MarkdownContent content={promptMd} />
          </div>
        ) : (
          <Textarea
            value={promptMd}
            onChange={(e) => setPromptMd(e.target.value)}
            rows={6}
            className="text-sm font-mono"
            placeholder="Текст задания. Формулы: $\sqrt{x}$ или $$\frac{a}{b}$$"
          />
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Правильный ответ {problem.correct_answer ? '' : '(отсутствует — можно добавить)'}</Label>
          <Input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            className="h-8 text-sm"
            placeholder="Пусто = без ответа (ручная проверка)"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Метод автопроверки</Label>
          <Select value={gradingMethod} onValueChange={setGradingMethod}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(gradingMethodLabel).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !promptMd.trim()}>
          {saving ? 'Сохранение...' : 'Сохранить'}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>
          Отмена
        </Button>
      </div>
    </div>
  )
}

// Ручное создание задания: OCR иногда объединяет несколько задач в один атом —
// учитель вырезает текст из соседнего задания и создаёт пропущенное здесь.
export function ProblemCreateForm({
  bookId, pageIndex, onSaved, onCancel,
}: {
  bookId: string
  pageIndex: number
  onSaved: () => void
  onCancel: () => void
}) {
  const [taskNumber, setTaskNumber] = useState('')
  const [promptMd, setPromptMd] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [answer, setAnswer] = useState('')
  const [gradingMethod, setGradingMethod] = useState('manual')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/books/${bookId}/problems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_index: pageIndex,
          task_number: taskNumber.trim(),
          prompt_md: promptMd,
          correct_answer: answer,
          grading_method: gradingMethod,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error ?? 'Ошибка создания')
        return
      }
      toast.success(`Задание № ${taskNumber.trim()} создано`)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 my-4 rounded-lg border-2 border-dashed border-primary/40 p-4">
      <p className="text-sm font-medium">Новое задание на этой странице</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Номер задания («736» или «5.31»)</Label>
          <Input
            value={taskNumber}
            onChange={(e) => setTaskNumber(e.target.value)}
            className="h-8 text-sm"
            placeholder="Как в книге"
          />
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Текст задания без номера (LaTeX: $формула$)</Label>
          <button
            type="button"
            onClick={() => setShowPreview(v => !v)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            {showPreview ? 'Редактировать' : 'Предпросмотр'}
          </button>
        </div>
        {showPreview ? (
          <div className="min-h-24 rounded-md border bg-muted/20 px-3 py-2">
            <MarkdownContent content={promptMd} />
          </div>
        ) : (
          <Textarea
            value={promptMd}
            onChange={(e) => setPromptMd(e.target.value)}
            rows={5}
            className="text-sm font-mono"
            placeholder="Вставьте текст задания, вырезанный из соседнего атома"
          />
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Правильный ответ (необязательно)</Label>
          <Input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            className="h-8 text-sm"
            placeholder="Пусто = без ответа"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Метод автопроверки</Label>
          <Select value={gradingMethod} onValueChange={setGradingMethod}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(gradingMethodLabel).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !promptMd.trim() || !taskNumber.trim()}>
          {saving ? 'Создание...' : 'Создать задание'}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>
          Отмена
        </Button>
      </div>
    </div>
  )
}

export function PageEditForm({
  bookId, page, onSaved, onCancel,
}: {
  bookId: string
  page: PageData
  onSaved: () => void
  onCancel: () => void
}) {
  const [md, setMd] = useState(page.markdown)
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/books/${bookId}/pages/${page.page_index}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: md }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error ?? 'Ошибка сохранения')
        return
      }
      if (d.anchors_lost > 0) {
        toast.warning(`Страница сохранена, но ${d.anchors_lost} заданий потеряли привязку (номер исчез из текста)`)
      } else {
        toast.success('Страница сохранена')
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 my-4 rounded-lg border-2 border-dashed p-4">
      <div className="flex items-center justify-between">
        <Label className="text-xs">
          Текст страницы{page.printed_page !== null ? ` ${page.printed_page}` : ''} (LaTeX: $формула$).
          Не удаляйте номера заданий в начале строк — по ним строится привязка.
        </Label>
        <button
          type="button"
          onClick={() => setShowPreview(v => !v)}
          className="text-xs text-muted-foreground hover:text-foreground underline shrink-0 ml-2"
        >
          {showPreview ? 'Редактировать' : 'Предпросмотр'}
        </button>
      </div>
      {showPreview ? (
        <div className="min-h-32 rounded-md border bg-muted/20 px-3 py-2">
          <MarkdownContent content={md} />
        </div>
      ) : (
        <Textarea
          value={md}
          onChange={(e) => setMd(e.target.value)}
          rows={16}
          className="text-sm font-mono"
        />
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !md.trim()}>
          {saving ? 'Сохранение...' : 'Сохранить страницу'}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>
          Отмена
        </Button>
      </div>
    </div>
  )
}
