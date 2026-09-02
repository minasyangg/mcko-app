'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Search, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LibraryProblemCard } from './LibraryProblemCard'
import { LibraryFilter, type Topic, type LibraryFilters } from './LibraryFilter'

interface Problem {
  id: string
  source_id: string | null
  source_domain: string | null
  source_url: string | null
  exam_type: string
  task_number_type: string | null
  prompt_text: string
  prompt_html: string | null
  correct_answer: unknown
  solution_html: string | null
  library_code: string | null
  canonical_topic: { id: string; fipicod: string | null; name: string } | null
}

interface Props {
  initialTopics: Topic[]
  totalProblems: number
}

const PER_PAGE   = 20   // первая страница — заполняем экран сразу
// Догружаем мелкими порциями: 20 задач с картинками и KaTeX рендерятся
// заметно дольше, чем едут по сети, поэтому «ещё» отдаём по 5 — кнопка
// откликается почти мгновенно вместо долгой паузы на пол-экрана.
const MORE_PAGE  = 5
const DEBOUNCE   = 350  // ms — wait before firing fetch on filter change

// ── URL ↔ state helpers ─────────────────────────────────────────────────────
function filtersToParams(f: LibraryFilters, sourceId: string): URLSearchParams {
  const p = new URLSearchParams()
  if (f.subject)        p.set('subject',    f.subject)
  if (f.examType)       p.set('exam_type',  f.examType)
  if (f.source !== 'all')     p.set('source',    f.source)
  if (f.hasAnswer !== 'all')  p.set('has_answer', f.hasAnswer)
  if (f.siteDomain !== 'all') p.set('site_domain', f.siteDomain)
  f.topicIds.forEach(id => p.append('canonical_topic_id', id))
  if (sourceId.trim()) p.set('source_id', sourceId.trim())
  return p
}

function filtersFromParams(sp: URLSearchParams): { filters: LibraryFilters; sourceId: string } {
  return {
    filters: {
      subject:     sp.get('subject')    ?? '',
      examType:    sp.get('exam_type')  ?? '',
      source:      sp.get('source')     ?? 'all',
      hasAnswer:   sp.get('has_answer') ?? 'all',
      siteDomain:  sp.get('site_domain') ?? 'all',
      topicIds:    sp.getAll('canonical_topic_id'),
      topicSearch: '',
    },
    sourceId: sp.get('source_id') ?? '',
  }
}

export function LibraryClient({ initialTopics, totalProblems }: Props) {
  const router   = useRouter()
  const pathname = usePathname()
  const sp       = useSearchParams()

  // Initialise from URL params so filters survive refresh and are shareable
  const { filters: initFilters, sourceId: initSourceId } = filtersFromParams(sp)

  const [filters,    setFilters]    = useState<LibraryFilters>(initFilters)
  const [sourceId,   setSourceId]   = useState(initSourceId)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})

  const [problems,   setProblems]   = useState<Problem[]>([])
  const [total,      setTotal]      = useState(0)
  const [page,       setPage]       = useState(1)
  const [loading,    setLoading]    = useState(false)
  const [resetting,  setResetting]  = useState(false)
  const [hasMore,    setHasMore]    = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Debounce timer ref — avoids hammering the API on rapid filter changes
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // AbortController ref — cancels in-flight requests when filters change
  const abortRef    = useRef<AbortController | null>(null)

  const fetchProblems = useCallback(async (p: number, reset = false) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setLoading(true)
    if (reset) setResetting(true)

    try {
      const params = filtersToParams(filters, sourceId)
      // Страницы разного размера: смещение считаем вручную, иначе page*per_page
      // на бэкенде перескочит через задачи первой (большой) страницы.
      const perPage = p === 1 ? PER_PAGE : MORE_PAGE
      params.set('offset',   String(p === 1 ? 0 : PER_PAGE + (p - 2) * MORE_PAGE))
      params.set('per_page', String(perPage))

      const res  = await fetch(`/api/library/problems?${params}`, { signal: ctrl.signal })
      if (!res.ok) throw new Error('fetch failed')
      const json = await res.json()

      setProblems(prev => reset ? (json.data ?? []) : [...prev, ...(json.data ?? [])])
      setTotal(json.total ?? 0)
      setHasMore(json.has_more ?? p < (json.total_pages ?? 1))
      setPage(p)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return  // superseded request — ignore
    } finally {
      setLoading(false)
      setResetting(false)
    }
  }, [filters, sourceId])

  // Debounced fetch on filter change — also syncs filters to URL
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      // Sync filters to URL (replaces history so Back works naturally)
      const params = filtersToParams(filters, sourceId)
      router.replace(`${pathname}?${params}`, { scroll: false })
      fetchProblems(1, true)
    }, DEBOUNCE)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sourceId])

  const handleFilterChange = useCallback((patch: Partial<LibraryFilters>) => {
    setFilters(prev => ({ ...prev, ...patch }))
    setPage(1)
  }, [])

  const handleToggleSection = useCallback((id: string) => {
    setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])

  // Active filter chips
  const hasFilters = !!(
    filters.subject || filters.examType ||
    filters.source !== 'all' || filters.hasAnswer !== 'all' ||
    filters.siteDomain !== 'all' || filters.topicIds.length || sourceId
  )

  const selectedSectionIds = new Set(
    filters.topicIds.filter(id => initialTopics.find(t => t.id === id)?.parent_id === null)
  )
  const activeChips: { label: string; onRemove: () => void }[] = []
  if (filters.subject)           activeChips.push({ label: filters.subject,  onRemove: () => handleFilterChange({ subject: '', topicIds: [] }) })
  if (filters.examType)          activeChips.push({ label: filters.examType, onRemove: () => handleFilterChange({ examType: '', topicIds: [] }) })
  if (filters.source !== 'all')  activeChips.push({ label: filters.source === 'verified' ? 'Глобальные' : 'Мои задачи', onRemove: () => handleFilterChange({ source: 'all' }) })
  if (filters.hasAnswer !== 'all') activeChips.push({ label: filters.hasAnswer === 'yes' ? 'С ответом' : 'Без ответа', onRemove: () => handleFilterChange({ hasAnswer: 'all' }) })
  if (filters.siteDomain !== 'all') activeChips.push({ label: filters.siteDomain === 'fipi' ? 'ФИПИ' : 'Сдамгиа', onRemove: () => handleFilterChange({ siteDomain: 'all' }) })
  for (const id of filters.topicIds) {
    const t = initialTopics.find(x => x.id === id)
    if (!t) continue
    if (t.parent_id && selectedSectionIds.has(t.parent_id)) continue
    activeChips.push({
      label: t.fipicod ? `${t.fipicod} ${t.name}` : t.name,
      onRemove: () => t.parent_id === null
        ? (() => {
            const childIds = initialTopics.filter(x => x.parent_id === t.id).map(x => x.id)
            handleFilterChange({ topicIds: filters.topicIds.filter(x => x !== id && !childIds.includes(x)) })
          })()
        : handleFilterChange({ topicIds: filters.topicIds.filter(x => x !== id) }),
    })
  }
  if (sourceId) activeChips.push({ label: `ID: ${sourceId}`, onRemove: () => setSourceId('') })

  const filterPanel = (
    <LibraryFilter
      filters={filters}
      onChange={handleFilterChange}
      topics={initialTopics}
      expandedSections={expandedSections}
      onToggleSection={handleToggleSection}
    />
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Библиотека задач</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalProblems.toLocaleString('ru-RU')} задач · ОГЭ/ЕГЭ Математика, Физика
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="md:hidden"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <SlidersHorizontal className="h-4 w-4 mr-1.5" />
          Фильтры
          {hasFilters && (
            <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
              {activeChips.length}
            </Badge>
          )}
        </Button>
      </div>

      {/* Search by code / source_id */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Поиск по коду: ФИЗ-02210 или по ID источника: 311672"
          value={sourceId}
          onChange={e => setSourceId(e.target.value)}
          className="pl-8 pr-8"
        />
        {sourceId && (
          <button
            onClick={() => setSourceId('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex gap-6 items-start">
        {/* Desktop sidebar */}
        <aside className={cn('w-56 shrink-0', 'hidden md:block')}>
          {filterPanel}
        </aside>

        {/* Mobile drawer */}
        {filtersOpen && (
          <div
            className="md:hidden fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
            onClick={() => setFiltersOpen(false)}
          >
            <div
              className="absolute left-0 top-0 bottom-0 w-72 bg-background border-r p-4 overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <span className="font-semibold text-sm">Фильтры</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFiltersOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {filterPanel}
            </div>
          </div>
        )}

        {/* Problem list */}
        <div className="flex-1 min-w-0 space-y-3 relative">
          {/* Loading overlay */}
          {resetting && loading && (
            <div className="absolute inset-0 bg-background/70 backdrop-blur-[1px] flex items-start justify-center pt-16 z-10 rounded-lg">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {/* Active filter chips */}
          {activeChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              {activeChips.map((chip, i) => (
                <Badge key={i} variant="secondary" className="gap-1 pr-1 text-xs h-6 font-normal">
                  {chip.label}
                  <button onClick={chip.onRemove} className="hover:text-destructive ml-0.5">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {activeChips.length > 1 && (
                <button
                  onClick={() => { handleFilterChange({ subject: '', examType: '', source: 'all', hasAnswer: 'all', siteDomain: 'all', topicIds: [], topicSearch: '' }); setSourceId('') }}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Сбросить все
                </button>
              )}
            </div>
          )}

          {/* Count */}
          <p className="text-sm text-muted-foreground">
            {loading && problems.length === 0
              ? 'Загрузка...'
              : `Найдено: ${total.toLocaleString('ru-RU')} задач`}
          </p>

          {/* Cards */}
          {problems.map(p => <LibraryProblemCard key={p.id} problem={p} />)}

          {/* Empty state */}
          {!loading && problems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <Search className="h-10 w-10 opacity-30" />
              <p className="text-sm">Задачи не найдены. Попробуйте изменить фильтры.</p>
              {hasFilters && (
                <Button variant="outline" size="sm" onClick={() => handleFilterChange({ subject: '', examType: '', source: 'all', hasAnswer: 'all', siteDomain: 'all', topicIds: [] })}>
                  Сбросить фильтры
                </Button>
              )}
            </div>
          )}

          {/* Лоадер догрузки. Первая загрузка/смена фильтров рисует оверлей
              выше — без этого условия оба спиннера крутились одновременно. */}
          {loading && !resetting && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Догрузка по требованию: подгружаем ровно MORE_PAGE задач за клик */}
          {hasMore && !loading && (
            <div className="flex flex-col items-center gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchProblems(page + 1)}
                className="w-full sm:w-auto"
              >
                + ещё {Math.min(MORE_PAGE, total - problems.length)}
                <span className="text-muted-foreground ml-1.5 font-normal">
                  (осталось {(total - problems.length).toLocaleString('ru-RU')})
                </span>
              </Button>
            </div>
          )}

          {!hasMore && problems.length > PER_PAGE && (
            <p className="text-center text-xs text-muted-foreground pt-2">
              Показано все {total.toLocaleString('ru-RU')} задач
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
