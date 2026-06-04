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
          ) : part.type === 'numeric' ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const cur = value[part.label] ?? ''
                  handleChange(part.label, cur.startsWith('-') ? cur.slice(1) : '-' + cur)
                }}
                disabled={disabled}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-background text-sm font-medium hover:bg-accent disabled:opacity-50 select-none"
                title="Изменить знак числа"
              >
                ±
              </button>
              <Input
                type="text"
                inputMode="decimal"
                value={value[part.label] ?? ''}
                onChange={(e) => handleChange(part.label, e.target.value)}
                disabled={disabled}
                placeholder={`Введите ответ для «${part.label}»...`}
              />
            </div>
          ) : (
            <Input
              type="text"
              inputMode="text"
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
