'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Loader2, Search, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LibraryProblemCard } from './LibraryProblemCard'

interface Topic {
  id: string
  exam_type: string
  subject: string
  grade: string | null
  fipicod: string | null
  name: string
  parent_id: string | null
  sort_order: number | null
}

interface Problem {
  id: string
  source_id: string | null
  source_domain: string | null
  source_url: string | null
  exam_type: string
  subject: string
  grade: string | null
  task_number_type: string | null
  prompt_text: string
  prompt_html: string | null
  task_type: string
  correct_answer: unknown
  grading_method: string
  default_max_score: number
  organization_id: string | null
  solution_html: string | null
  topic_id: string | null
  library_topics: { id: string; fipicod: string | null; name: string } | null
}

interface Props {
  initialTopics: Topic[]
  totalProblems: number
}

const SUBJECTS = ['Математика', 'Физика', 'Химия', 'Биология', 'Информатика', 'Русский язык', 'История']
const EXAM_TYPES = ['ОГЭ', 'ЕГЭ', 'ВПР', 'ГВЭ']
const GRADES = ['5', '6', '7', '8', '9', '10', '11']
const PER_PAGE = 20

export function LibraryClient({ initialTopics, totalProblems }: Props) {
  // ── Фильтры ──────────────────────────────────────────────────────────────
  const [source,    setSource]    = useState<'all' | 'verified' | 'custom'>('all')
  const [subject,   setSubject]   = useState('')
  const [examType,  setExamType]  = useState('')
  const [grade,     setGrade]     = useState('')
  const [topicIds,  setTopicIds]  = useState<string[]>([])
  const [sourceId,  setSourceId]  = useState('')
  const [query,     setQuery]     = useState('')
  const [topicSearch, setTopicSearch] = useState('')

  // ── Данные ────────────────────────────────────────────────────────────────
  const [problems,  setProblems]  = useState<Problem[]>([])
  const [total,     setTotal]     = useState(0)
  const [page,      setPage]      = useState(1)
  const [loading,   setLoading]   = useState(false)
  const [hasMore,   setHasMore]   = useState(false)

  // ── Мобильная панель фильтров ─────────────────────────────────────────────
  const [filtersOpen, setFiltersOpen] = useState(false)

  // ── Темы: разделы и подтемы ───────────────────────────────────────────────
  const sections = initialTopics.filter(t =>
    t.parent_id === null &&
    (!subject   || t.subject   === subject) &&
    (!examType  || t.exam_type === examType)
  )

  const subtopicsOf = (sectionId: string) =>
    initialTopics.filter(t =>
      t.parent_id === sectionId &&
      (!topicSearch || t.name.toLowerCase().includes(topicSearch.toLowerCase()) ||
        (t.fipicod ?? '').includes(topicSearch))
    )

  // ── Загрузка задач ────────────────────────────────────────────────────────
  const fetchProblems = useCallback(async (p: number, reset = false) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(p))
      params.set('per_page', String(PER_PAGE))
      if (source !== 'all') params.set('source', source)
      if (subject)   params.set('subject', subject)
      if (examType)  params.set('exam_type', examType)
      if (grade)     params.set('grade', grade)
      topicIds.forEach(id => params.append('topic_id', id))
      if (sourceId.trim()) params.set('source_id', sourceId.trim())
      else if (query.trim()) params.set('q', query.trim())

      const res  = await fetch(`/api/library/problems?${params}`)
      const json = await res.json()

      setProblems(prev => reset ? json.data : [...prev, ...json.data])
      setTotal(json.total)
      setHasMore(p < json.total_pages)
      setPage(p)
    } finally {
      setLoading(false)
    }
  }, [source, subject, examType, grade, topicIds, sourceId, query])

  // Сброс и перезагрузка при изменении фильтров
  useEffect(() => {
    fetchProblems(1, true)
  }, [fetchProblems])

  // IntersectionObserver для автозагрузки
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting && !loading) fetchProblems(page + 1) },
      { rootMargin: '300px' }
    )
    io.observe(sentinelRef.current)
    return () => io.disconnect()
  }, [hasMore, loading, page, fetchProblems])

  const hasFilters = !!(source !== 'all' || subject || examType || grade || topicIds.length || sourceId || query)

  const resetFilters = () => {
    setSource('all'); setSubject(''); setExamType(''); setGrade('')
    setTopicIds([]); setSourceId(''); setQuery(''); setTopicSearch('')
  }

  const toggleTopic = (id: string) =>
    setTopicIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  // ── Панель фильтров ────────────────────────────────────────────────────────
  const FilterPanel = () => (
    <div className="space-y-5">
      {/* Источник */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Источник</p>
        {(['all', 'verified', 'custom'] as const).map(s => (
          <label key={s} className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="source" value={s} checked={source === s}
              onChange={() => setSource(s)} className="accent-primary" />
            <span className="text-sm">
              {s === 'all' ? 'Все' : s === 'verified' ? 'Верифицированные' : 'Мои задачи'}
            </span>
          </label>
        ))}
      </div>

      {/* Предмет */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Предмет</p>
        <Select value={subject || 'all'} onValueChange={v => { setSubject(v === 'all' ? '' : v); setTopicIds([]) }}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Все предметы" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все предметы</SelectItem>
            {SUBJECTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Тип экзамена */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Тип экзамена</p>
        <Select value={examType || 'all'} onValueChange={v => { setExamType(v === 'all' ? '' : v); setTopicIds([]) }}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Все экзамены" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            {EXAM_TYPES.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Класс */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Класс</p>
        <Select value={grade || 'all'} onValueChange={v => setGrade(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Все классы" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все классы</SelectItem>
            {GRADES.map(g => <SelectItem key={g} value={g}>{g} класс</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Разделы и подтемы */}
      {sections.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Раздел / Подтема</p>
          <Input
            placeholder="Поиск тем..."
            value={topicSearch}
            onChange={e => setTopicSearch(e.target.value)}
            className="h-7 text-xs"
          />
          <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
            {sections.map(sec => {
              const subs = subtopicsOf(sec.id)
              const allSectionIds = [sec.id, ...subs.map(s => s.id)]
              const anySelected = allSectionIds.some(id => topicIds.includes(id))
              return (
                <div key={sec.id}>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox"
                      className="accent-primary h-3.5 w-3.5 cursor-pointer"
                      checked={topicIds.includes(sec.id)}
                      onChange={() => toggleTopic(sec.id)}
                    />
                    <span className={cn('text-xs font-medium', anySelected && 'text-primary')}>
                      {sec.name}
                    </span>
                  </label>
                  {subs.length > 0 && (
                    <div className="ml-5 mt-1 space-y-1">
                      {subs.map(sub => (
                        <label key={sub.id} className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox"
                            className="accent-primary h-3.5 w-3.5 cursor-pointer"
                            checked={topicIds.includes(sub.id)}
                            onChange={() => toggleTopic(sub.id)}
                          />
                          <span className="text-xs text-muted-foreground">
                            {sub.fipicod ? `${sub.fipicod} ` : ''}{sub.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Поиск по ID */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Поиск по ID задачи
        </Label>
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">#</span>
          <Input
            placeholder="311672"
            value={sourceId}
            onChange={e => setSourceId(e.target.value.replace(/\D/g, ''))}
            className="h-8 text-sm pl-6"
          />
        </div>
      </div>

      {/* Сброс */}
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={resetFilters} className="w-full text-xs h-7">
          <X className="h-3 w-3 mr-1" />
          Сбросить фильтры
        </Button>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Заголовок */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Библиотека задач</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalProblems.toLocaleString('ru-RU')} задач · ОГЭ Математика, Физика
          </p>
        </div>
        <Button variant="outline" size="sm" className="md:hidden" onClick={() => setFiltersOpen(!filtersOpen)}>
          <SlidersHorizontal className="h-4 w-4 mr-1.5" />
          Фильтры
          {hasFilters && <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{topicIds.length + (subject ? 1 : 0) + (examType ? 1 : 0)}</Badge>}
        </Button>
      </div>

      {/* Строка поиска */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Поиск по тексту задания..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="pl-8"
          disabled={!!sourceId}
        />
      </div>

      <div className="flex gap-6 items-start">
        {/* Боковая панель фильтров (desktop) */}
        <aside className={cn(
          'w-56 shrink-0 space-y-5',
          'hidden md:block',
          filtersOpen && 'block!'
        )}>
          <FilterPanel />
        </aside>

        {/* Мобильная панель */}
        {filtersOpen && (
          <div className="md:hidden fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" onClick={() => setFiltersOpen(false)}>
            <div className="absolute left-0 top-0 bottom-0 w-72 bg-background border-r p-4 overflow-y-auto"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <span className="font-semibold text-sm">Фильтры</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFiltersOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <FilterPanel />
            </div>
          </div>
        )}

        {/* Список задач */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Счётчик результатов */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {loading && problems.length === 0
                ? 'Загрузка...'
                : `Найдено: ${total.toLocaleString('ru-RU')} задач`}
            </span>
            {topicIds.length > 0 && (
              <span>{topicIds.length} тем выбрано</span>
            )}
          </div>

          {/* Карточки задач */}
          {problems.map(p => (
            <LibraryProblemCard key={p.id} problem={p} />
          ))}

          {/* Пустое состояние */}
          {!loading && problems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <Search className="h-10 w-10 opacity-30" />
              <p className="text-sm">Задачи не найдены. Попробуйте изменить фильтры.</p>
              {hasFilters && (
                <Button variant="outline" size="sm" onClick={resetFilters}>Сбросить фильтры</Button>
              )}
            </div>
          )}

          {/* Загрузка */}
          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Sentinel для автозагрузки + кнопка "Ещё" */}
          {hasMore && !loading && (
            <div className="flex flex-col items-center gap-3 pt-2">
              <div ref={sentinelRef} />
              <Button variant="outline" size="sm" onClick={() => fetchProblems(page + 1)}
                className="w-full sm:w-auto">
                Ещё задачи ({total - problems.length} осталось)
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
