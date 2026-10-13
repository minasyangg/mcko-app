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
  subjects: { subject: string; count: number }[]
  grades: string[]
  /** Сколько блоков без учёта фильтра по предмету — для кнопки «Все» */
  total: number
}

const selectClass = 'h-9 rounded-md border border-input bg-background px-2 text-sm'

// Панель фильтров каталога теории: поиск, класс и быстрые фильтры по предмету.
// Общая для «Библиотека → Теория» и выбора теории со страницы ДЗ.
export function TheoryFilters({ value, onChange, subjects, grades, total }: Props) {
  const set = (patch: Partial<TheoryFilterState>) => onChange({ ...value, ...patch })
  const active = value.q || value.subject || value.grade

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
      {subjects.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Предмет">
          <Chip on={!value.subject} onClick={() => set({ subject: '' })} label="Все предметы" count={total} />
          {subjects.map(({ subject, count }) => (
            <Chip
              key={subject}
              on={value.subject === subject}
              // повторный клик по выбранному предмету снимает фильтр
              onClick={() => set({ subject: value.subject === subject ? '' : subject })}
              label={subject}
              count={count}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Chip({ on, onClick, label, count }: { on: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-sm transition-colors',
        on
          ? 'border-sky-500 bg-sky-500 text-white'
          : count === 0
            ? 'border-border bg-background text-muted-foreground/60 hover:bg-muted'
            : 'border-border bg-background text-foreground hover:bg-muted',
      )}
    >
      {label} <span className={on ? 'text-sky-100' : 'text-muted-foreground'}>{count}</span>
    </button>
  )
}
