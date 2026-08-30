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

// Показывается, когда у задания нет своей подсказки (task.answer_format_hint
// пуст) — в т.ч. для числовых частей составного ответа (Composite.tsx их не
// передаёт вовсе). Без неё ученик угадывает формат сам и пишет "22 целых 1/2"
// вместо "22 1/2" — алгоритм проверки такое не разбирает (см. normalizeNumeric).
const DEFAULT_HINT = 'Дробь: 1/2 или 2 1/3 (можно переключателем ниже). Десятичное: через точку или запятую — 0.5 или 0,5.'

export function Numeric({ value, onChange, hint, disabled }: NumericProps) {
  const [isFraction, setIsFraction] = useState(false)
  const displayHint = hint ?? DEFAULT_HINT

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
      <p className="text-xs text-muted-foreground">{displayHint}</p>
    </div>
  )
}
