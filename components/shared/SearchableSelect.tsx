'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
  /** Второй строкой под названием: предмет, класс, дата — что уточняет выбор */
  hint?: string | null
  /** Короткая метка справа: «ДЗ», «10 класс» */
  badge?: string | null
}

interface Props {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Заголовок группы, в которую попадают первые `recentCount` вариантов */
  recentLabel?: string
  /** Сколько первых вариантов считать «недавними». 0 — не выделять группу */
  recentCount?: number
  emptyText?: string
  disabled?: boolean
}

/**
 * Выпадающий список с поиском и прокруткой.
 *
 * Зачем не обычный Select: у учителя со временем накапливаются десятки тестов
 * и сотни учеников, и простой список превращается в неуправляемую простыню —
 * нужного приходится искать глазами. Здесь список ограничен по высоте,
 * прокручивается, ищется по подстроке, а сверху отдельной группой стоят
 * последние добавленные (их и выбирают чаще всего).
 */
export function SearchableSelect({
  options, value, onChange, placeholder = 'Выберите...',
  recentLabel = 'Последние', recentCount = 5,
  emptyText = 'Ничего не найдено', disabled = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.value === value)

  // Закрытие по клику вне и по Esc — стандартное поведение выпадающих списков,
  // без него список остаётся висеть поверх формы
  useEffect(() => {
    if (!open) return
    function onDocDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) close()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Фокус в поиск при открытии. Сброс запроса делаем не здесь, а в момент
  // закрытия (setOpen ниже): синхронный setState в эффекте вызывает лишний
  // каскад рендеров.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function close() {
    setOpen(false)
    setQuery('')
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o =>
      o.label.toLowerCase().includes(q) ||
      (o.hint ?? '').toLowerCase().includes(q))
  }, [options, query])

  // Группу «последние» показываем только когда искать не начали: при активном
  // поиске деление на группы мешает — важен один список совпадений
  const showGroups = !query.trim() && recentCount > 0 && options.length > recentCount
  const recent = showGroups ? filtered.slice(0, recentCount) : []
  const rest = showGroups ? filtered.slice(recentCount) : filtered

  function pick(v: string) {
    onChange(v)
    close()
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-md border bg-transparent px-3 py-1 text-sm',
          'focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <span className={cn('truncate', !selected && 'text-muted-foreground')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          <div className="flex items-center gap-2 border-b px-2.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Поиск..."
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="shrink-0 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Высота ограничена: длинный список прокручивается внутри себя,
              а не растягивает диалог за пределы экрана */}
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
            )}

            {recent.length > 0 && (
              <>
                <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {recentLabel}
                </p>
                {recent.map(o => (
                  <Row key={o.value} option={o} active={o.value === value} onPick={pick} />
                ))}
                {rest.length > 0 && (
                  <p className="mt-1 border-t px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Остальные
                  </p>
                )}
              </>
            )}

            {rest.map(o => (
              <Row key={o.value} option={o} active={o.value === value} onPick={pick} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({
  option, active, onPick,
}: {
  option: SelectOption
  active: boolean
  onPick: (v: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(option.value)}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
        active ? 'bg-accent' : 'hover:bg-accent/60',
      )}
    >
      <Check className={cn('h-3.5 w-3.5 shrink-0', active ? 'opacity-100' : 'opacity-0')} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{option.label}</span>
        {option.hint && (
          <span className="block truncate text-xs text-muted-foreground">{option.hint}</span>
        )}
      </span>
      {option.badge && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {option.badge}
        </span>
      )}
    </button>
  )
}
