'use client'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

interface Part {
  label: string
  type: string
}

interface CompositeProps {
  parts: Part[]
  value: Record<string, string>
  onChange: (v: Record<string, string>) => void
  disabled?: boolean
}

export function Composite({ parts, value, onChange, disabled }: CompositeProps) {
  function handleChange(label: string, text: string) {
    onChange({ ...value, [label]: text })
  }

  return (
    <div className="space-y-4">
      {parts.map((part) => (
        <div key={part.label} className="space-y-1.5">
          <Label className="text-sm font-medium">{part.label}</Label>
          {part.type === 'text' ? (
            <Textarea
              value={value[part.label] ?? ''}
              onChange={(e) => handleChange(part.label, e.target.value)}
              disabled={disabled}
              placeholder={`Введите ответ для «${part.label}»...`}
              rows={2}
              className="resize-y"
            />
          ) : (
            <Input
              type="text"
              inputMode={part.type === 'numeric' ? 'decimal' : 'text'}
              value={value[part.label] ?? ''}
              onChange={(e) => handleChange(part.label, e.target.value)}
              disabled={disabled}
              placeholder={`Введите ответ для «${part.label}»...`}
            />
          )}
        </div>
      ))}
    </div>
  )
}
