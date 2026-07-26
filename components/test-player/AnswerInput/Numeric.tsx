'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { FractionInput } from './FractionInput'

interface NumericProps {
  value: string
  onChange: (v: string) => void
  hint?: string | null
  disabled?: boolean
}

export function Numeric({ value, onChange, hint, disabled }: NumericProps) {
  const [isFraction, setIsFraction] = useState(false)

  function toggleMinus() {
    onChange(value.startsWith('-') ? value.slice(1) : '-' + value)
  }

  return (
    <div className="space-y-2">
      {isFraction ? (
        <FractionInput value={value} onChange={onChange} disabled={disabled} />
      ) : (
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
      )}
      <button
        type="button"
        onClick={() => setIsFraction((v) => !v)}
        disabled={disabled}
        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
      >
        {isFraction ? 'Ввести десятичным числом' : 'Ввести дробью'}
      </button>
      {hint && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}
