'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import MarkdownContent from '@/components/shared/MarkdownContent'
import { AddToTestDialog } from '@/components/teacher/AddToTestDialog'
import { AddTargetBanner } from '@/components/teacher/AddTargetBanner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  ArrowLeft, ChevronRight, ChevronDown, ChevronUp, Plus, Search, X,
  CheckCircle2, Flame, BookOpen, Pencil, Trash2, Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { taskNumberLabel } from '@/lib/books/anchors'

// Общие типы/утилиты и формы редактирования — в ./book-reader/
import {
  type Book, type Section, type PageData, type ProblemAnchor, type SearchResult,
  stripTaskNumber,
} from './book-reader/shared'
import { ProblemEditForm, ProblemCreateForm, PageEditForm } from './book-reader/forms'

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

interface SectionDeletePreview {
  title: string
  sections_count: number
  problems_count: number
  test_usage: Array<{ test_id: string; title: string; count: number }>
}

function TocItem({
  node, depth, selectedId, onSelect, canEdit, bookId, onChanged,
}: {
  node: TocNode
  depth: number
  selectedId: string | null
  onSelect: (node: TocNode) => void
  canEdit: boolean
  bookId: string
  onChanged: () => void
}) {
  const [open, setOpen] = useState(depth === 0)
  const hasChildren = node.children.length > 0
  const selectable = node.page_start !== null

  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState(node.title)
  const [savingTitle, setSavingTitle] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [preview, setPreview] = useState<SectionDeletePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleSaveTitle() {
    const title = titleDraft.trim()
    if (!title) { toast.error('Название не может быть пустым'); return }
    if (title === node.title) { setRenaming(false); return }
    setSavingTitle(true)
    try {
      const res = await fetch(`/api/books/${bookId}/sections/${node.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error ?? 'Ошибка сохранения'); return }
      toast.success('Название сохранено')
      setRenaming(false)
      onChanged()
    } finally {
      setSavingTitle(false)
    }
  }

  async function openDelete() {
    setDeleteOpen(true)
    setPreview(null)
    setPreviewLoading(true)
    try {
      const res = await fetch(`/api/books/${bookId}/sections/${node.id}`)
      if (res.ok) setPreview(await res.json())
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/books/${bookId}/sections/${node.id}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error ?? 'Ошибка удаления'); return }
      const usage = (d.test_usage ?? []) as SectionDeletePreview['test_usage']
      const usageNote = usage.length
        ? ` Уже было в тестах: ${usage.map(t => `«${t.title}» (${t.count})`).join(', ')}.`
        : ''
      toast.success(`Удалено: ${d.deleted_problems} заданий, ${d.deleted_sections} раздел(ов).${usageNote}`)
      setDeleteOpen(false)
      onChanged()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div
        className={cn(
          'group flex items-start gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors',
          selectedId === node.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted',
          !selectable && 'cursor-default text-muted-foreground',
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => {
          if (renaming) return
          if (hasChildren) setOpen(!open)
          if (selectable) onSelect(node)
        }}
      >
        {hasChildren ? (
          open ? <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {renaming ? (
          <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <Input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTitle()
                if (e.key === 'Escape') { setTitleDraft(node.title); setRenaming(false) }
              }}
              autoFocus
              disabled={savingTitle}
              className="h-6 text-xs px-1.5"
            />
            <button
              type="button"
              onClick={handleSaveTitle}
              disabled={savingTitle}
              title="Сохранить"
              className="text-green-600 hover:text-green-700 shrink-0"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => { setTitleDraft(node.title); setRenaming(false) }}
              disabled={savingTitle}
              title="Отмена"
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <>
            <span className="leading-snug flex-1 min-w-0">
              {node.kind === 'chapter' && node.number ? `Глава ${node.number}. ` : node.number ? `${node.number}. ` : ''}
              {node.title}
            </span>
            {canEdit && (
              <span
                className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => setRenaming(true)}
                  title="Переименовать раздел"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={openDelete}
                  title="Удалить раздел и все его задания"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            )}
          </>
        )}
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map(c => (
            <TocItem
              key={c.id} node={c} depth={depth + 1} selectedId={selectedId} onSelect={onSelect}
              canEdit={canEdit} bookId={bookId} onChanged={onChanged}
            />
          ))}
        </div>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={(open) => { if (!open) setDeleteOpen(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить «{node.title}»?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <span className="block">
                {previewLoading ? (
                  'Проверяю содержимое раздела...'
                ) : preview ? (
                  <>
                    Будет удалено {preview.problems_count} заданий
                    {preview.sections_count > 1 ? ` из ${preview.sections_count} разделов (включая вложенные)` : ''}
                    {' '}безвозвратно.
                    {preview.test_usage.length > 0 && (
                      <span className="block mt-2 font-medium text-destructive">
                        Внимание: {preview.test_usage.reduce((s, t) => s + t.count, 0)} из этих заданий уже
                        добавлены в тесты: {preview.test_usage.map(t => `«${t.title}» (${t.count})`).join(', ')}.
                        Их копии в тестах сохранятся, но из книги задания исчезнут.
                      </span>
                    )}
                  </>
                ) : (
                  'Не удалось получить информацию о разделе.'
                )}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete() }}
              disabled={deleting || previewLoading || !preview}
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
  page, problems, onAdd, addedProblems, highlightId, canEdit, bookId, onChanged,
}: {
  page: PageData
  problems: ProblemAnchor[]
  onAdd: (p: ProblemAnchor) => void
  addedProblems: Map<string, string>
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
  const [deletingPage, setDeletingPage] = useState(false)
  const [deletingPageBusy, setDeletingPageBusy] = useState(false)

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

  async function handleDeletePage() {
    setDeletingPageBusy(true)
    try {
      const res = await fetch(`/api/books/${bookId}/pages/${page.page_index}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error ?? 'Ошибка удаления страницы')
        return
      }
      toast.success(`Страница${page.printed_page !== null ? ` ${page.printed_page}` : ''} удалена`)
      setDeletingPage(false)
      onChanged()
    } finally {
      setDeletingPageBusy(false)
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
            <button
              type="button"
              onClick={() => setDeletingPage(true)}
              title="Удалить страницу и все задания на ней"
              className="text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </>
        )}
        <div className="h-px bg-border flex-1" />
      </div>

      <AlertDialog open={deletingPage} onOpenChange={(open) => { if (!open) setDeletingPage(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Удалить страницу{page.printed_page !== null ? ` ${page.printed_page}` : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Страница и все задания на ней будут удалены из книги безвозвратно.
              Нумерация страниц и номера остальных заданий не изменятся — связи
              не потеряются. В тестах, куда задания уже добавлены, их копии сохранятся.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingPageBusy}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeletePage() }}
              disabled={deletingPageBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingPageBusy ? 'Удаление...' : 'Удалить страницу'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                {addedProblems.has(seg.problem.id) && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] text-green-600 font-medium max-w-40 truncate"
                    title={`Добавлено в «${addedProblems.get(seg.problem.id)}»`}
                  >
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    <span className="truncate">в «{addedProblems.get(seg.problem.id)}»</span>
                  </span>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAdd(seg.problem)}
                  title={addedProblems.has(seg.problem.id) ? 'Добавить ещё раз / в другой тест' : 'Добавить в тест или ДЗ'}
                  className={cn(
                    'h-7 w-7 p-0 rounded-full transition-all',
                    addedProblems.has(seg.problem.id)
                      ? 'border-green-500 text-green-600 hover:bg-green-500 hover:text-white opacity-100'
                      : 'opacity-60 group-hover:opacity-100 hover:bg-primary hover:text-primary-foreground',
                  )}
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

export function BookReader({
  book, sections: initialSections, canEdit = false, canDelete = false, editorsPanel = null,
  initialSectionId = null, initialTask = null, initialProblemId = null,
}: {
  book: Book
  sections: Section[]
  canEdit?: boolean
  canDelete?: boolean
  editorsPanel?: React.ReactNode
  // Deep-link из общего поиска каталога: открыть раздел и проскроллить к заданию
  initialSectionId?: string | null
  initialTask?: string | null
  initialProblemId?: string | null
}) {
  const router = useRouter()
  const [deletingBook, setDeletingBook] = useState(false)

  async function handleDeleteBook() {
    setDeletingBook(true)
    try {
      const res = await fetch(`/api/books/${book.id}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error ?? 'Ошибка удаления'); setDeletingBook(false); return }
      toast.success(`Книга «${book.title}» удалена`)
      router.push('/teacher/books')
      router.refresh()
    } catch {
      setDeletingBook(false)
    }
  }

  const [sections, setSections] = useState(initialSections)
  const tree = useMemo(() => buildTree(sections), [sections])
  const sectionById = useMemo(() => new Map(sections.map(s => [s.id, s])), [sections])

  // Первый выбираемый раздел — первый лист с диапазоном страниц
  const firstLeaf = useMemo(() => {
    const leaves = sections.filter(s =>
      s.page_start !== null && !sections.some(c => c.parent_id === s.id))
    return leaves[0] ?? null
  }, [sections])

  const [selected, setSelected] = useState<Section | null>(() => {
    if (initialSectionId) {
      const s = initialSections.find(x => x.id === initialSectionId && x.page_start !== null)
      if (s) return s
    }
    return firstLeaf
  })

  // После переименования/удаления раздела — перечитать дерево; если выбранный
  // раздел (или его предок) был удалён, выбрать первый доступный лист
  const reloadSections = useCallback(async () => {
    const res = await fetch(`/api/books/${book.id}/sections`)
    if (!res.ok) return
    const data = await res.json()
    const next: Section[] = data.sections ?? []
    setSections(next)
    setSelected(prev => {
      if (prev) {
        const stillExists = next.find(s => s.id === prev.id)
        if (stillExists) return stillExists
      }
      const leaves = next.filter(s => s.page_start !== null && !next.some(c => c.parent_id === s.id))
      return leaves[0] ?? null
    })
  }, [book.id])
  const [pages, setPages] = useState<PageData[] | null>(null)
  const [problems, setProblems] = useState<ProblemAnchor[]>([])
  const [loading, setLoading] = useState(false)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)

  const [dialogProblem, setDialogProblem] = useState<ProblemAnchor | null>(null)
  // id заданий, добавленных в тест в этой сессии (метка «добавлено», без reload)
  const [addedProblems, setAddedProblems] = useState<Map<string, string>>(new Map())
  const [highlightId, setHighlightId] = useState<string | null>(initialProblemId)
  const scrollTarget = useRef<string | null>(initialTask)

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
          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm"
                  className="h-6 -ml-2 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-3 w-3 mr-1" /> Удалить книгу
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Удалить книгу «{book.title}»?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Книга со всеми разделами, страницами и заданиями будет удалена безвозвратно.
                    Задания, уже добавленные в тесты, там сохранятся.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deletingBook}>Отмена</AlertDialogCancel>
                  <AlertDialogAction onClick={(e) => { e.preventDefault(); handleDeleteBook() }}
                    disabled={deletingBook}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    {deletingBook ? 'Удаление...' : 'Удалить'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        {/* Админский блок «Доступ на редактирование» (грант book_editors) */}
        {editorsPanel}
        <div className="flex-1 overflow-y-auto py-2">
          {tree.map(node => (
            <TocItem
              key={node.id}
              node={node}
              depth={0}
              selectedId={selected?.id ?? null}
              onSelect={(n) => setSelected(n)}
              canEdit={canEdit}
              bookId={book.id}
              onChanged={reloadSections}
            />
          ))}
        </div>
      </aside>

      {/* ── Content ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header: поиск */}
        <div className="border-b p-3 shrink-0 relative space-y-2">
          <AddTargetBanner />
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
                addedProblems={addedProblems}
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
        onAdded={(title) => {
          if (dialogProblem) setAddedProblems(prev => new Map(prev).set(dialogProblem.id, title))
        }}
      />
    </div>
  )
}
