'use client'

import { Input } from '@/components/ui/input'

interface NumericProps {
  value: string
  onChange: (v: string) => void
  hint?: string | null
  disabled?: boolean
}

export function Numeric({ value, onChange, hint, disabled }: NumericProps) {
  return (
    <div className="space-y-2">
      <Input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={hint ?? 'Введите числовой ответ...'}
        className="max-w-xs"
      />
      {hint && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}
