'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import MarkdownContent from '@/components/shared/MarkdownContent'
import { AddToTestDialog } from '@/components/teacher/AddToTestDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ArrowLeft, ChevronRight, ChevronDown, ChevronUp, Plus, Search, X,
  CheckCircle2, Flame, BookOpen, Pencil, Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { visibleTaskNumber, taskNumberLabel } from '@/lib/books/anchors'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Book {
  id: string
  title: string
  authors: string | null
  subject: string
  grade: string | null
  level: string | null
  page_count: number | null
}

interface Section {
  id: string
  parent_id: string | null
  kind: string
  number: string | null
  title: string
  page_start: number | null
  page_end: number | null
  sort_order: number
}

interface PageData {
  page_index: number
  printed_page: number | null
  markdown: string
}

interface ProblemAnchor {
  id: string
  task_number: string
  task_number_sort: number | null
  page_index: number
  md_start: number | null
  md_end: number | null
  prompt_md: string
  correct_answer: { text?: string } | null
  answer_source: string
  difficulty: string
  grading_method: string
  used_count: number
}

// Методы автопроверки для ответов из книги (тот же набор, что в тестах)
const gradingMethodLabel: Record<string, string> = {
  normalized: 'Нормализованное сравнение',
  exact: 'Точное совпадение',
  numeric_tolerance: 'Числовой (допуск)',
  sequence: 'Последовательность цифр (соответствие)',
  set_match: 'Совпадение набора',
  manual: 'Ручная проверка',
}

interface SearchResult {
  id: string
  task_number: string
  section_id: string | null
  page_index: number
  answer_source: string
  snippet: string
}

// ─── TOC tree ─────────────────────────────────────────────────────────────────

interface TocNode extends Section {
  children: TocNode[]
}

function buildTree(sections: Section[]): TocNode[] {
  const byId = new Map<string, TocNode>()
  for (const s of sections) byId.set(s.id, { ...s, children: [] })
  const roots: TocNode[] = []
  for (const s of sections) {
    const node = byId.get(s.id)!
    if (s.parent_id && byId.has(s.parent_id)) byId.get(s.parent_id)!.children.push(node)
    else roots.push(node)
  }
  return roots
}

function TocItem({
  node, depth, selectedId, onSelect,
}: {
  node: TocNode
  depth: number
  selectedId: string | null
  onSelect: (node: TocNode) => void
}) {
  const [open, setOpen] = useState(depth === 0)
  const hasChildren = node.children.length > 0
  const selectable = node.page_start !== null

  return (
    <div>
      <div
        className={cn(
          'flex items-start gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors',
          selectedId === node.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted',
          !selectable && 'cursor-default text-muted-foreground',
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => {
          if (hasChildren) setOpen(!open)
          if (selectable) onSelect(node)
        }}
      >
        {hasChildren ? (
          open ? <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="leading-snug">
          {node.kind === 'chapter' && node.number ? `Глава ${node.number}. ` : node.number ? `${node.number}. ` : ''}
          {node.title}
        </span>
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map(c => (
            <TocItem key={c.id} node={c} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Номер задания ────────────────────────────────────────────────────────────
// В markdown страницы номер обязан оставаться (по нему строятся привязки и
// поиск), но пользователю он показывается только бейджем рамки. Из текста
// задания перед отображением и редактированием номер вырезается; при
// сохранении сервер восстанавливает его сам.

function stripTaskNumber(md: string, taskNumber: string): string {
  // ДКР-задание «к1.2.3» в тексте напечатано видимым номером «3.»
  const esc = visibleTaskNumber(taskNumber).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return md.replace(
    new RegExp(`^[ \\t]*(?:[^0-9A-Za-zА-Яа-яЁё#<\\s$([{]|[oOоОοΟ0])?[ \\t]*${esc}[*°]?[.)][*°]?[ \\t]*`),
    '',
  )
}

// ─── Формы редактирования (по образцу EditTaskForm из тестов) ─────────────────

function ProblemEditForm({
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
function ProblemCreateForm({
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

function PageEditForm({
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

// ─── Свёртка теории ────────────────────────────────────────────────────────────
// Учитель работает с заданиями; теорию показываем свёрнутой: первые ~6 предложений,
// остальное — по кнопке. Скрытая часть не рендерится вовсе (картинки не грузятся).

const THEORY_SENTENCE_LIMIT = 6
const THEORY_TAIL_MIN = 250 // не сворачиваем, если скрылось бы меньше символов

// Позиция конца N-го предложения. Формулы, теги и таблицы маскируем символами
// той же длины, чтобы точки внутри них не считались и разрез не попал внутрь.
function findTheoryCut(md: string): number | null {
  const mask = (s: string, re: RegExp) => s.replace(re, m => '\x00'.repeat(m.length))
  let masked = mask(md, /<table[\s\S]*?<\/table>/gi)
  masked = mask(masked, /\$\$[\s\S]*?\$\$/g)
  masked = mask(masked, /\$[^$\n]*?\$/g)
  masked = mask(masked, /!\[[^\]]*\]\([^)]*\)/g)
  masked = mask(masked, /<[^>]+>/g)
  const re = /[.!?…](?=\s|$)/g
  let count = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(masked)) !== null) {
    count++
    if (count >= THEORY_SENTENCE_LIMIT) {
      const cut = m.index + 1
      return md.length - cut < THEORY_TAIL_MIN ? null : cut
    }
  }
  return null
}

function TheoryBlock({ md }: { md: string }) {
  const [expanded, setExpanded] = useState(false)
  const cut = useMemo(() => findTheoryCut(md), [md])

  if (cut === null) return <MarkdownContent content={md} />

  return (
    <div>
      <MarkdownContent content={expanded ? md : md.slice(0, cut)} />
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="mt-1 mb-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        {expanded
          ? <><ChevronUp className="h-3.5 w-3.5" /> Свернуть теорию</>
          : <><ChevronDown className="h-3.5 w-3.5" /> Показать полностью</>}
      </button>
    </div>
  )
}

// ─── Page renderer: текст страницы с интерактивными врезками заданий ──────────

function PageBlock({
  page, problems, onAdd, highlightId, canEdit, bookId, onChanged,
}: {
  page: PageData
  problems: ProblemAnchor[]
  onAdd: (p: ProblemAnchor) => void
  highlightId: string | null
  canEdit: boolean
  bookId: string
  onChanged: () => void
}) {
  const [editingPage, setEditingPage] = useState(false)
  const [creatingTask, setCreatingTask] = useState(false)
  const [editingProblemId, setEditingProblemId] = useState<string | null>(null)
  const [deletingProblem, setDeletingProblem] = useState<ProblemAnchor | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!deletingProblem) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/books/problems/${deletingProblem.id}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error ?? 'Ошибка удаления')
        return
      }
      toast.success(`Задание ${taskNumberLabel(deletingProblem.task_number)} удалено`)
      setDeletingProblem(null)
      onChanged()
    } finally {
      setDeleting(false)
    }
  }
  // Разбиваем markdown страницы на сегменты: обычный текст / задание
  const segments = useMemo(() => {
    const md = page.markdown
    const anchored = problems
      .filter(p => p.md_start !== null && p.md_end !== null && p.md_end <= md.length)
      .sort((a, b) => (a.md_start! - b.md_start!))
    const out: Array<{ type: 'text'; md: string } | { type: 'problem'; md: string; problem: ProblemAnchor }> = []
    let pos = 0
    for (const p of anchored) {
      if (p.md_start! > pos) out.push({ type: 'text', md: md.slice(pos, p.md_start!) })
      out.push({ type: 'problem', md: md.slice(p.md_start!, p.md_end!), problem: p })
      pos = p.md_end!
    }
    if (pos < md.length) out.push({ type: 'text', md: md.slice(pos) })
    return out
  }, [page.markdown, problems])

  if (editingPage) {
    return (
      <PageEditForm
        bookId={bookId}
        page={page}
        onSaved={() => { setEditingPage(false); onChanged() }}
        onCancel={() => setEditingPage(false)}
      />
    )
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-3 my-4 select-none">
        <div className="h-px bg-border flex-1" />
        <span className="text-[11px] text-muted-foreground">
          {page.printed_page !== null ? `стр. ${page.printed_page}` : '···'}
        </span>
        {canEdit && (
          <>
            <button
              type="button"
              onClick={() => setEditingPage(true)}
              title="Редактировать текст страницы"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => setCreatingTask(true)}
              title="Создать задание на этой странице (если OCR склеил задачи)"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        <div className="h-px bg-border flex-1" />
      </div>
      {creatingTask && (
        <ProblemCreateForm
          bookId={bookId}
          pageIndex={page.page_index}
          onSaved={() => { setCreatingTask(false); onChanged() }}
          onCancel={() => setCreatingTask(false)}
        />
      )}
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          seg.md.trim() ? <TheoryBlock key={i} md={seg.md} /> : null
        ) : (
          <div
            key={i}
            id={`problem-${seg.problem.task_number}`}
            className={cn(
              'group my-3 rounded-lg border px-3 py-2 transition-colors',
              highlightId === seg.problem.id
                ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                : 'border-border hover:border-primary/40 hover:bg-muted/30',
            )}
          >
            {/* Шапка: бейджи слева, кнопки справа — в потоке, за рамку не выходят */}
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 flex-wrap min-w-0 pt-1">
                <span className="text-xs font-semibold text-primary">{taskNumberLabel(seg.problem.task_number)}</span>
                {seg.problem.answer_source !== 'none' && (
                  <Badge variant="outline" className="text-[10px] h-4.5 gap-1 text-green-700 border-green-300">
                    <CheckCircle2 className="h-3 w-3" /> ответ
                  </Badge>
                )}
                {seg.problem.difficulty === 'advanced' && (
                  <Badge variant="outline" className="text-[10px] h-4.5 gap-1 text-orange-600 border-orange-300">
                    <Flame className="h-3 w-3" /> повышенная
                  </Badge>
                )}
                {seg.problem.used_count > 0 && (
                  <span className="text-[10px] text-muted-foreground">в тестах: {seg.problem.used_count}</span>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAdd(seg.problem)}
                  title="Добавить в тест"
                  className="h-7 w-7 p-0 rounded-full opacity-60 group-hover:opacity-100 hover:bg-primary hover:text-primary-foreground transition-all"
                >
                  <Plus className="h-4 w-4" />
                </Button>
                {canEdit && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingProblemId(editingProblemId === seg.problem.id ? null : seg.problem.id)}
                      title="Редактировать задание"
                      className="h-7 w-7 p-0 rounded-full opacity-60 group-hover:opacity-100 transition-all"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDeletingProblem(seg.problem)}
                      title="Удалить задание из книги"
                      className="h-7 w-7 p-0 rounded-full opacity-60 group-hover:opacity-100 hover:bg-destructive hover:text-destructive-foreground transition-all"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
            <MarkdownContent content={stripTaskNumber(seg.md, seg.problem.task_number)} />
            {editingProblemId === seg.problem.id && (
              <ProblemEditForm
                problem={seg.problem}
                onSaved={() => { setEditingProblemId(null); onChanged() }}
                onCancel={() => setEditingProblemId(null)}
              />
            )}
          </div>
        )
      )}

      <AlertDialog open={deletingProblem !== null} onOpenChange={(open) => { if (!open) setDeletingProblem(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Удалить задание {deletingProblem ? taskNumberLabel(deletingProblem.task_number) : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Задание будет удалено из книги и из базы безвозвратно: текст исчезнет
              со страницы, поиск его больше не найдёт. В тестах, куда оно уже
              добавлено, копия задания сохранится.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete() }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Удаление...' : 'Удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function BookReader({ book, sections, canEdit = false }: { book: Book; sections: Section[]; canEdit?: boolean }) {
  const tree = useMemo(() => buildTree(sections), [sections])
  const sectionById = useMemo(() => new Map(sections.map(s => [s.id, s])), [sections])

  // Первый выбираемый раздел — первый лист с диапазоном страниц
  const firstLeaf = useMemo(() => {
    const leaves = sections.filter(s =>
      s.page_start !== null && !sections.some(c => c.parent_id === s.id))
    return leaves[0] ?? null
  }, [sections])

  const [selected, setSelected] = useState<Section | null>(firstLeaf)
  const [pages, setPages] = useState<PageData[] | null>(null)
  const [problems, setProblems] = useState<ProblemAnchor[]>([])
  const [loading, setLoading] = useState(false)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)

  const [dialogProblem, setDialogProblem] = useState<ProblemAnchor | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const scrollTarget = useRef<string | null>(null)

  const loadSection = useCallback(async (s: Section) => {
    if (s.page_start === null) return
    setLoading(true)
    try {
      const to = s.page_end ?? s.page_start
      const res = await fetch(`/api/books/${book.id}/pages?from=${s.page_start}&to=${to}`)
      if (!res.ok) return
      const data = await res.json()
      setPages(data.pages)
      setProblems(data.problems)
    } finally {
      setLoading(false)
    }
  }, [book.id])

  useEffect(() => {
    if (selected) loadSection(selected)
  }, [selected, loadSection])

  // Скролл к найденному заданию после загрузки раздела
  useEffect(() => {
    if (!scrollTarget.current || loading || !pages) return
    const el = document.getElementById(`problem-${scrollTarget.current}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      scrollTarget.current = null
      setTimeout(() => setHighlightId(null), 3500)
    }
  }, [pages, loading])

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) { setResults(null); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/books/${book.id}/search?q=${encodeURIComponent(query.trim())}`)
      if (!res.ok) return
      const data = await res.json()
      setResults(data.results)
    } finally {
      setSearching(false)
    }
  }

  function jumpTo(r: SearchResult) {
    setResults(null)
    setQuery('')
    setHighlightId(r.id)
    scrollTarget.current = r.task_number
    const section = r.section_id ? sectionById.get(r.section_id) : null
    if (section && section.id !== selected?.id) {
      setSelected(section)
    } else if (selected) {
      // раздел уже открыт — просто скроллим
      const el = document.getElementById(`problem-${r.task_number}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        scrollTarget.current = null
        setTimeout(() => setHighlightId(null), 3500)
      }
    }
  }

  return (
    <div className="flex h-[calc(100vh-0px)] md:h-screen">
      {/* ── Sidebar: содержание ── */}
      <aside className="hidden md:flex w-80 shrink-0 border-r flex-col">
        <div className="p-4 border-b space-y-1 shrink-0">
          <Button asChild variant="ghost" size="sm" className="h-7 -ml-2 px-2 text-muted-foreground">
            <Link href="/teacher/books">
              <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Все книги
            </Link>
          </Button>
          <h1 className="font-semibold text-sm leading-snug">{book.title}</h1>
          {book.authors && <p className="text-xs text-muted-foreground line-clamp-2">{book.authors}</p>}
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {tree.map(node => (
            <TocItem
              key={node.id}
              node={node}
              depth={0}
              selectedId={selected?.id ?? null}
              onSelect={(n) => setSelected(n)}
            />
          ))}
        </div>
      </aside>

      {/* ── Content ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header: поиск */}
        <div className="border-b p-3 shrink-0 relative">
          <form onSubmit={handleSearch} className="flex gap-2 max-w-xl">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Номер задания (735) или текст..."
                className="pl-8 h-9"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); setResults(null) }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Button type="submit" size="sm" className="h-9" disabled={searching}>
              {searching ? 'Поиск...' : 'Найти'}
            </Button>
          </form>

          {/* Результаты поиска */}
          {results !== null && (
            <div className="absolute left-3 right-3 top-full z-30 max-w-xl mt-1 rounded-md border bg-background shadow-lg max-h-80 overflow-y-auto">
              {results.length === 0 && (
                <p className="px-4 py-3 text-sm text-muted-foreground">Ничего не найдено</p>
              )}
              {results.map(r => (
                <button
                  key={r.id}
                  onClick={() => jumpTo(r)}
                  className="w-full text-left px-4 py-2.5 hover:bg-muted border-b last:border-0 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-primary shrink-0">{taskNumberLabel(r.task_number)}</span>
                    {r.answer_source !== 'none' && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                    )}
                    <span className="text-xs text-muted-foreground truncate">{r.snippet}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Mobile: селект раздела */}
        <div className="md:hidden border-b p-3 shrink-0">
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={selected?.id ?? ''}
            onChange={(e) => {
              const s = sectionById.get(e.target.value)
              if (s) setSelected(s)
            }}
          >
            {sections.filter(s => s.page_start !== null).map(s => (
              <option key={s.id} value={s.id}>
                {s.number ? `${s.number}. ` : ''}{s.title}
              </option>
            ))}
          </select>
        </div>

        {/* Тело раздела */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 md:px-8 py-6">
            {selected && (
              <div className="mb-4">
                <h2 className="text-lg font-semibold">
                  {selected.number ? `${selected.number}. ` : ''}{selected.title}
                </h2>
              </div>
            )}

            {loading && (
              <div className="space-y-3 py-4">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            )}

            {!loading && !selected && (
              <div className="flex flex-col items-center py-20 text-muted-foreground gap-2">
                <BookOpen className="h-8 w-8" />
                <p className="text-sm">Выберите раздел в содержании</p>
              </div>
            )}

            {!loading && pages?.map(page => (
              <PageBlock
                key={page.page_index}
                page={page}
                problems={problems.filter(p => p.page_index === page.page_index)}
                onAdd={setDialogProblem}
                highlightId={highlightId}
                canEdit={canEdit}
                bookId={book.id}
                onChanged={() => { if (selected) loadSection(selected) }}
              />
            ))}
          </div>
        </div>
      </div>

      <AddToTestDialog
        open={dialogProblem !== null}
        onClose={() => setDialogProblem(null)}
        addUrl={dialogProblem ? `/api/books/problems/${dialogProblem.id}/add-to-test` : null}
        problemLabel={dialogProblem ? `№ ${dialogProblem.task_number}` : ''}
      />
    </div>
  )
}
