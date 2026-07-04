'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import MarkdownContent from '@/components/shared/MarkdownContent'
import { AddToTestDialog } from '@/components/teacher/AddToTestDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ArrowLeft, ChevronRight, ChevronDown, Plus, Search, X,
  CheckCircle2, Flame, BookOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'

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
  answer_source: string
  difficulty: string
  grading_method: string
  used_count: number
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

// ─── Page renderer: текст страницы с интерактивными врезками заданий ──────────

function PageBlock({
  page, problems, onAdd, highlightId,
}: {
  page: PageData
  problems: ProblemAnchor[]
  onAdd: (p: ProblemAnchor) => void
  highlightId: string | null
}) {
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

  return (
    <div className="relative">
      {page.printed_page !== null && (
        <div className="flex items-center gap-3 my-4 select-none">
          <div className="h-px bg-border flex-1" />
          <span className="text-[11px] text-muted-foreground">стр. {page.printed_page}</span>
          <div className="h-px bg-border flex-1" />
        </div>
      )}
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          seg.md.trim() ? <MarkdownContent key={i} content={seg.md} /> : null
        ) : (
          <div
            key={i}
            id={`problem-${seg.problem.task_number}`}
            className={cn(
              'group relative my-3 rounded-lg border pl-3 pr-10 py-2 transition-colors',
              highlightId === seg.problem.id
                ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                : 'border-border hover:border-primary/40 hover:bg-muted/30',
            )}
          >
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs font-semibold text-primary">№ {seg.problem.task_number}</span>
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
            <MarkdownContent content={seg.md} />
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAdd(seg.problem)}
              title="Добавить в тест"
              className="absolute right-2 top-2 h-7 w-7 p-0 rounded-full opacity-60 group-hover:opacity-100 hover:bg-primary hover:text-primary-foreground transition-all"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function BookReader({ book, sections }: { book: Book; sections: Section[] }) {
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
                    <span className="text-sm font-semibold text-primary shrink-0">№ {r.task_number}</span>
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
