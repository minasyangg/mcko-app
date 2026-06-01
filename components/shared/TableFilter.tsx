'use client'

import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Типы ──────────────────────────────────────────────────────────────────────

export interface FilterField {
  key: string
  label: string
  type: 'text' | 'select'
  placeholder?: string
  /** Статические опции для select. Если не указаны — выводятся из данных автоматически. */
  options?: { value: string; label: string }[]
  /** Ширина поля (Tailwind класс, например 'w-40') */
  width?: string
}

// ── Хелпер: получить значение по ключу ────────────────────────────────────────

function getValue(obj: unknown, key: string): string {
  const val = (obj as Record<string, unknown>)?.[key]
  return val == null ? '' : String(val)
}

// ── Хук: логика фильтрации ────────────────────────────────────────────────────

export function useTableFilter<T extends object>(data: T[], fields: FilterField[]) {
  const [filters, setFilters] = useState<Record<string, string>>({})

  const setFilter = (key: string, value: string) =>
    setFilters(prev => ({ ...prev, [key]: value }))

  const clearFilters = () => setFilters({})

  const hasActiveFilters = Object.values(filters).some(Boolean)

  const filtered = useMemo(() => {
    if (!hasActiveFilters) return data
    return data.filter(row =>
      fields.every(field => {
        const filterVal = (filters[field.key] ?? '').trim()
        if (!filterVal) return true
        const rowVal = getValue(row, field.key).toLowerCase()
        if (field.type === 'select') return rowVal === filterVal.toLowerCase()
        return rowVal.includes(filterVal.toLowerCase())
      })
    )
  }, [data, filters, hasActiveFilters, fields])

  return { filtered, filters, setFilter, clearFilters, hasActiveFilters }
}

// ── Компонент: панель фильтров ────────────────────────────────────────────────

interface TableFilterBarProps {
  fields: FilterField[]
  filters: Record<string, string>
  setFilter: (key: string, value: string) => void
  clearFilters: () => void
  hasActiveFilters: boolean
  /** Данные для автоматического вывода опций select */
  data?: object[]
  className?: string
}

export function TableFilterBar({
  fields, filters, setFilter, clearFilters, hasActiveFilters, data, className,
}: TableFilterBarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {fields.map(field => {
        if (field.type === 'select') {
          // Авто-опции из данных если не заданы статически
          const opts = field.options ?? (data
            ? [...new Set(data.map(r => getValue(r, field.key)).filter(Boolean))].sort()
                .map(v => ({ value: v, label: v }))
            : [])

          return (
            <select
              key={field.key}
              value={filters[field.key] ?? ''}
              onChange={e => setFilter(field.key, e.target.value)}
              className={cn(
                'h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground',
                'focus:outline-none focus:ring-1 focus:ring-ring',
                field.width ?? 'w-32',
              )}
            >
              <option value="">{field.placeholder ?? `Все (${field.label})`}</option>
              {opts.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )
        }

        return (
          <Input
            key={field.key}
            value={filters[field.key] ?? ''}
            onChange={e => setFilter(field.key, e.target.value)}
            placeholder={field.placeholder ?? field.label}
            className={cn('h-8 text-sm', field.width ?? 'w-44')}
          />
        )
      })}

      {hasActiveFilters && (
        <button
          onClick={clearFilters}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          Сбросить
        </button>
      )}
    </div>
  )
}
