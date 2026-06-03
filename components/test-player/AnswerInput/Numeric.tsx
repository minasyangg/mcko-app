'use client'

import { Input } from '@/components/ui/input'

interface NumericProps {
  value: string
  onChange: (v: string) => void
  hint?: string | null
  disabled?: boolean
}

export function Numeric({ value, onChange, hint, disabled }: NumericProps) {
  function toggleMinus() {
    onChange(value.startsWith('-') ? value.slice(1) : '-' + value)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 max-w-xs">
        <button
          type="button"
          onClick={toggleMinus}
          disabled={disabled}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-background text-sm font-medium hover:bg-accent disabled:opacity-50 select-none"
          title="Изменить знак числа"
        >
          ±
        </button>
        <Input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={hint ?? 'Введите числовой ответ...'}
        />
      </div>
      {hint && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}
