'use client'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

interface ShortTextProps {
  value: string
  onChange: (v: string) => void
  hint?: string | null
  disabled?: boolean
  size?: 'small' | 'medium' | 'large'
}

export function ShortText({ value, onChange, hint, disabled, size = 'medium' }: ShortTextProps) {
  return (
    <div className="space-y-2">
      {size === 'small' ? (
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={hint ?? 'Введите ответ...'}
          className="max-w-sm"
        />
      ) : (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={hint ?? 'Введите ответ...'}
          rows={size === 'large' ? 7 : 3}
          className="resize-y"
        />
      )}
      {hint && size !== 'small' && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}
