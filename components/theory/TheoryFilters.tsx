'use client'

import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { TheoryFilterState } from '@/lib/theory/filter'
import { EMPTY_THEORY_FILTER } from '@/lib/theory/filter'

interface Props {
  value: TheoryFilterState
  onChange: (next: TheoryFilterState) => void
  subjects: string[]
  grades: string[]
  tags: { tag: string; count: number }[]
  /** Сколько тегов показывать до «ещё…» */
  tagLimit?: number
}

const selectClass = 'h-9 rounded-md border border-input bg-background px-2 text-sm'

// Панель фильтров каталога теории: поиск, предмет, класс, облако тегов.
// Общая для «Библиотека → Теория» и выбора теории со страницы ДЗ.
export function TheoryFilters({ value, onChange, subjects, grades, tags, tagLimit = 30 }: Props) {
  const set = (patch: Partial<TheoryFilterState>) => onChange({ ...value, ...patch })
  const toggleTag = (t: string) =>
    set({ tags: value.tags.includes(t) ? value.tags.filter((x) => x !== t) : [...value.tags, t] })
  const active = value.q || value.subject || value.grade || value.tags.length > 0

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Поиск по названию, тексту, тегам"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <select className={selectClass} value={value.subject} onChange={(e) => set({ subject: e.target.value })} aria-label="Предмет">
          <option value="">Все предметы</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={selectClass} value={value.grade} onChange={(e) => set({ grade: e.target.value })} aria-label="Класс">
          <option value="">Все классы</option>
          {grades.map((g) => <option key={g} value={g}>{/^\d+$/.test(g) ? `${g} класс` : g}</option>)}
        </select>
        {active && (
          <Button variant="ghost" size="sm" className="h-9" onClick={() => onChange(EMPTY_THEORY_FILTER)}>
            <X className="mr-1 h-3.5 w-3.5" /> Сбросить
          </Button>
        )}
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.slice(0, tagLimit).map(({ tag, count }) => {
            const on = value.tags.includes(tag)
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                  on
                    ? 'border-sky-500 bg-sky-500 text-white'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                {tag} <span className={on ? 'text-sky-100' : 'text-muted-foreground/70'}>{count}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
