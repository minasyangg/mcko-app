'use client'

import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { Sparkles, Loader2, Pencil, Check, X } from 'lucide-react'
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
import { formatCompositeAnswerForEdit } from '@/lib/grading/multi-part-answer'
import { formatAnswerJsonRaw, wrapBareLatex } from '@/lib/grading/format-answer-display'
import { MathText } from '@/components/shared/MathText'
import type { Json } from '@/types/database'
import { gradingMethodLabel, stripTaskNumber, type PageData, type ProblemAnchor } from './shared'

// Ответ ИИ на составное задание («а)…; б)…») хранится не как {text}, а как
// {parts:{...}} (см. multi-part-answer.ts) — без этого разбора поле было бы
// пустым несмотря на бейдж «ответ · ИИ». formatAnswerJsonRaw (без $…$-обёртки
// голого LaTeX) — значение уходит обратно в это же текстовое поле формы и
// может быть пересохранено без изменений; formatAnswerJson добавил бы
// доллары, которых не было в источнике.
function answerToEditText(correctAnswer: ProblemAnchor['correct_answer']): string {
  if (!correctAnswer) return ''
  if (typeof correctAnswer.text === 'string') return correctAnswer.text
  const json = correctAnswer as unknown as Json
  return formatCompositeAnswerForEdit(json) ?? formatAnswerJsonRaw(json)
}

// ─── Ответ сразу под условием (по образцу LibraryProblemCard) ─────────────────
// Раньше единственным способом узнать ответ было раскрыть полную форму
// редактирования задания (текст + ответ + метод проверки разом) — в библиотеке
// ФИПИ/ЕГЭ ответ виден сразу под условием, в книгах нет. Показываем строку
// «Ответ: …» так же, как в LibraryProblemCard, с редактированием по наведению
// (карандаш), независимо от ProblemEditForm — та остаётся для правки текста
// задания и метода проверки.
export function InlineAnswer({
  problem, canEdit, onSaved,
}: {
  problem: ProblemAnchor
  canEdit: boolean
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const answerText = answerToEditText(problem.correct_answer)
  const hasAnswer = answerText.trim() !== ''

  function startEditing() {
    setInput(answerText)
    setEditing(true)
    setError(null)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function cancelEditing() {
    setEditing(false)
    setInput('')
    setError(null)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/books/problems/${problem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correct_answer: input }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Ошибка сохранения')
        return
      }
      setEditing(false)
      onSaved()
    } catch {
      setError('Ошибка соединения')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="space-y-1 mt-1" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground shrink-0">Ответ:</span>
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancelEditing() }}
            className="h-7 text-sm flex-1"
            placeholder="Введите ответ..."
            disabled={saving}
          />
          <button onClick={save} disabled={saving} title="Сохранить"
            className="text-green-600 hover:text-green-700 disabled:opacity-50">
            <Check className="h-4 w-4" />
          </button>
          <button onClick={cancelEditing} disabled={saving} title="Отмена"
            className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  if (!hasAnswer) {
    if (!canEdit) return null
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); startEditing() }}
        className="mt-1 text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
      >
        <Pencil className="h-3 w-3" />
        Добавить ответ
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 mt-1">
      <p className="text-sm">
        <span className="text-muted-foreground">Ответ: </span>
        <MathText text={wrapBareLatex(answerText)} className="font-medium" />
      </p>
      {canEdit && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); startEditing() }}
          title="Изменить ответ"
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

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
  const [answer, setAnswer] = useState(() => answerToEditText(problem.correct_answer))
  const [gradingMethod, setGradingMethod] = useState(problem.grading_method)
  const [saving, setSaving] = useState(false)
  const [aiGenerating, setAiGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAiAnswer() {
    setAiGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/books/problems/${problem.id}/ai-answer`, { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error ?? 'ИИ не смог решить задание')
        return
      }
      // ответ уже сохранён сервером с answer_source='ai' — закрываем форму,
      // читалка перезагрузит якоря и покажет бейдж «ответ · ИИ»
      toast.success(`Ответ ИИ для задания ${taskNumberLabel(problem.task_number)}: ${d.correct_answer?.text ?? ''}`)
      onSaved()
    } finally {
      setAiGenerating(false)
    }
  }

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
          {!problem.correct_answer && !answer.trim() && (
            <button
              type="button"
              onClick={handleAiAnswer}
              disabled={aiGenerating || problem.has_images}
              title={problem.has_images
                ? 'Задание с изображением — ИИ-решение недоступно'
                : 'ИИ решит задание и сохранит эталонный ответ'}
              className="text-xs text-violet-600 dark:text-violet-400 hover:text-violet-700 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {aiGenerating
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Sparkles className="h-3 w-3" />}
              {aiGenerating ? 'ИИ решает…' : 'Сгенерировать ответ ИИ'}
            </button>
          )}
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
