'use client'

import { Textarea } from '@/components/ui/textarea'

interface ShortTextProps {
  value: string
  onChange: (v: string) => void
  hint?: string | null
  disabled?: boolean
}

export function ShortText({ value, onChange, hint, disabled }: ShortTextProps) {
  return (
    <div className="space-y-2">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={hint ?? 'Введите ответ...'}
        rows={4}
        className="resize-y"
      />
      {hint && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}
