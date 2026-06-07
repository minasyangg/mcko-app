'use client'

import { useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Topic {
  id: string
  exam_type: string
  subject: string
  grade: string | null
  fipicod: string | null
  name: string
  parent_id: string | null
  sort_order: number | null
}

export interface LibraryFilters {
  subject: string
  examType: string
  source: string      // 'all' | 'verified' | 'custom'
  hasAnswer: string   // 'all' | 'yes' | 'no'
  siteDomain: string  // 'all' | 'fipi' | 'sdamgia'
  topicIds: string[]
  topicSearch: string
}

interface Props {
  filters: LibraryFilters
  onChange: (patch: Partial<LibraryFilters>) => void
  topics: Topic[]
  expandedSections: Record<string, boolean>
  onToggleSection: (id: string) => void
}

// Subject list by exam type — avoids showing irrelevant subjects
const SUBJECTS_BY_EXAM: Record<string, string[]> = {
  ОГЭ:  ['Математика', 'Физика', 'Химия', 'Биология', 'История', 'Обществознание', 'Информатика', 'Русский язык', 'Литература', 'География'],
  ЕГЭ:  ['Математика', 'Математика (база)', 'Физика', 'Химия', 'Биология', 'История', 'Обществознание', 'Информатика', 'Русский язык', 'Литература', 'География', 'Английский язык'],
  ВПР:  ['Математика', 'Физика', 'Химия', 'Биология', 'История', 'Обществознание', 'Русский язык', 'География'],
  ГВЭ:  ['Математика', 'Русский язык'],
}
const ALL_SUBJECTS = ['Математика', 'Математика (база)', 'Физика', 'Химия', 'Биология', 'История', 'Обществознание', 'Информатика', 'Русский язык', 'Литература', 'География', 'Английский язык']
const EXAM_TYPES   = ['ОГЭ', 'ЕГЭ', 'ВПР', 'ГВЭ']

function ToggleGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: [string, string][]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex rounded-md border divide-x overflow-hidden text-xs">
        {options.map(([val, lbl]) => (
          <button
            key={val}
            type="button"
            onClick={() => onChange(val)}
            className={cn(
              'flex-1 py-1.5 text-center transition-colors',
              value === val
                ? 'bg-primary text-primary-foreground font-medium'
                : 'hover:bg-muted text-muted-foreground'
            )}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  )
}

export function LibraryFilter({ filters, onChange, topics, expandedSections, onToggleSection }: Props) {
  const { subject, examType, source, hasAnswer, siteDomain, topicIds, topicSearch } = filters

  // Subjects available for the selected exam type
  const subjectOptions = examType ? (SUBJECTS_BY_EXAM[examType] ?? ALL_SUBJECTS) : ALL_SUBJECTS

  // Canonical sections for selected subject+examType
  const sections = topics.filter(t =>
    t.parent_id === null &&
    (!subject  || t.subject   === subject) &&
    (!examType || t.exam_type === examType)
  )

  const subtopicsOf = useCallback((sectionId: string) =>
    topics.filter(t =>
      t.parent_id === sectionId &&
      (!topicSearch || t.name.toLowerCase().includes(topicSearch.toLowerCase()) ||
        (t.fipicod ?? '').includes(topicSearch))
    ),
    [topics, topicSearch]
  )

  const toggleTopic = (id: string) =>
    onChange({
      topicIds: topicIds.includes(id)
        ? topicIds.filter(x => x !== id)
        : [...topicIds, id],
    })

  const toggleSectionGroup = (sectionId: string) => {
    const childIds = topics.filter(t => t.parent_id === sectionId).map(t => t.id)
    const allIds   = [sectionId, ...childIds]
    const anySelected = allIds.some(id => topicIds.includes(id))
    onChange({
      topicIds: anySelected
        ? topicIds.filter(id => !allIds.includes(id))
        : [...new Set([...topicIds, ...allIds])],
    })
  }

  const hasFilters = !!(
    subject || examType || source !== 'all' || hasAnswer !== 'all' ||
    siteDomain !== 'all' || topicIds.length
  )

  return (
    <div className="space-y-4">

      {/* Экзамен */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Экзамен</p>
        <div className="flex rounded-md border divide-x overflow-hidden text-xs">
          {['', ...EXAM_TYPES].map(et => (
            <button
              key={et || '_all'}
              type="button"
              onClick={() => onChange({ examType: et, subject: '', topicIds: [] })}
              className={cn(
                'flex-1 py-1.5 text-center transition-colors',
                examType === et
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'hover:bg-muted text-muted-foreground'
              )}
            >
              {et || 'Все'}
            </button>
          ))}
        </div>
      </div>

      {/* Предмет — опции зависят от выбранного типа экзамена */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Предмет</p>
        <Select
          value={subject || '_all'}
          onValueChange={v => onChange({ subject: v === '_all' ? '' : v, topicIds: [] })}
        >
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Все предметы" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Все предметы</SelectItem>
            {subjectOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Источник */}
      <ToggleGroup
        label="Источник"
        options={[['all', 'Все'], ['verified', 'Глоб.'], ['custom', 'Мои']]}
        value={source}
        onChange={v => onChange({ source: v })}
      />

      {/* Ответ */}
      <ToggleGroup
        label="Ответ"
        options={[['all', 'Все'], ['yes', 'Есть'], ['no', 'Нет']]}
        value={hasAnswer}
        onChange={v => onChange({ hasAnswer: v })}
      />

      {/* База задач */}
      <ToggleGroup
        label="База задач"
        options={[['all', 'Все'], ['fipi', 'ФИПИ'], ['sdamgia', 'Сдамгиа']]}
        value={siteDomain}
        onChange={v => onChange({ siteDomain: v })}
      />

      {/* Темы КЭС — только если выбран предмет+экзамен с каноническими темами */}
      {sections.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Темы КЭС</p>
            {topicIds.length > 0 && (
              <button
                onClick={() => onChange({ topicIds: [] })}
                className="text-[10px] text-muted-foreground hover:text-foreground underline"
              >
                Сбросить
              </button>
            )}
          </div>
          <Input
            placeholder="Поиск тем..."
            value={topicSearch}
            onChange={e => onChange({ topicSearch: e.target.value })}
            className="h-7 text-xs"
          />
          <div className="space-y-0.5 max-h-72 overflow-y-auto pr-1">
            {sections.map(sec => {
              const allSubs     = topics.filter(t => t.parent_id === sec.id)
              const subs        = subtopicsOf(sec.id)
              const isExpanded  = !!expandedSections[sec.id] || !!topicSearch
              const anySelected = [sec.id, ...allSubs.map(s => s.id)].some(id => topicIds.includes(id))

              return (
                <div key={sec.id}>
                  <div className="flex items-center gap-1 py-1 rounded hover:bg-muted/50">
                    <button
                      type="button"
                      onClick={() => onToggleSection(sec.id)}
                      className="p-0.5 text-muted-foreground hover:text-foreground shrink-0"
                    >
                      {isExpanded
                        ? <ChevronDown className="h-3 w-3" />
                        : <ChevronRight className="h-3 w-3" />}
                    </button>
                    <label className="flex items-center gap-1.5 cursor-pointer flex-1 min-w-0">
                      <input
                        type="checkbox"
                        className="accent-primary h-3.5 w-3.5 cursor-pointer shrink-0"
                        checked={anySelected}
                        onChange={() => toggleSectionGroup(sec.id)}
                      />
                      <span className={cn('text-xs font-medium leading-tight truncate', anySelected && 'text-primary')}>
                        {sec.fipicod ? `${sec.fipicod}. ` : ''}{sec.name}
                      </span>
                    </label>
                  </div>

                  {isExpanded && subs.length > 0 && (
                    <div className="ml-5 space-y-0.5 mb-1">
                      {subs.map(sub => (
                        <label
                          key={sub.id}
                          className="flex items-center gap-1.5 cursor-pointer py-0.5 rounded hover:bg-muted/50 px-1"
                        >
                          <input
                            type="checkbox"
                            className="accent-primary h-3 w-3 cursor-pointer shrink-0"
                            checked={topicIds.includes(sub.id)}
                            onChange={() => toggleTopic(sub.id)}
                          />
                          <span className={cn(
                            'text-xs leading-tight',
                            topicIds.includes(sub.id) ? 'text-primary font-medium' : 'text-muted-foreground'
                          )}>
                            {sub.fipicod && <span className="font-mono mr-1">{sub.fipicod}</span>}
                            {sub.name}
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

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({
            subject: '', examType: '', source: 'all',
            hasAnswer: 'all', siteDomain: 'all', topicIds: [], topicSearch: '',
          })}
          className="w-full text-xs h-7"
        >
          <X className="h-3 w-3 mr-1" />
          Сбросить все фильтры
        </Button>
      )}
    </div>
  )
}
