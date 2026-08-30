'use client'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MathText } from '@/components/shared/MathText'

interface ShortTextProps {
  value: string
  onChange: (v: string) => void
  hint?: string | null
  disabled?: boolean
  size?: 'small' | 'medium' | 'large'
  // Развёрнутый ответ (решение с объяснением) может содержать формулы —
  // показываем подсказку по синтаксису и живой предпросмотр рендера.
  // Не включаем по умолчанию: для короткого/однострочного ответа (номер,
  // слово) это лишний шум, а не помощь.
  supportsMath?: boolean
}

export function ShortText({ value, onChange, hint, disabled, size = 'medium', supportsMath }: ShortTextProps) {
  const showMathPreview = supportsMath && value.includes('$')
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
      {supportsMath && size !== 'small' && (
        <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-1">
          <span>Формулы можно записывать в KaTeX:</span>
          <code className="px-1 rounded bg-muted">$x^2$</code>
          <span>→</span>
          <MathText text="$x^2$" />
          <span>,</span>
          <code className="px-1 rounded bg-muted">{'$\\frac{a}{b}$'}</code>
          <span>→</span>
          <MathText text="$\frac{a}{b}$" />
        </p>
      )}
      {showMathPreview && (
        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <p className="text-[11px] text-muted-foreground mb-1">Предпросмотр:</p>
          <MathText text={value} className="text-sm" />
        </div>
      )}
    </div>
  )
}
