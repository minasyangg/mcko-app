'use client'

interface Option {
  id: string
  text: string
}

interface MultipleChoiceProps {
  options: Option[]
  value: string[]
  onChange: (v: string[]) => void
  disabled?: boolean
}

export function MultipleChoice({ options, value, onChange, disabled }: MultipleChoiceProps) {
  const selected = new Set(value)

  function toggle(id: string) {
    if (disabled) return
    const next = new Set(selected)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    onChange(Array.from(next))
  }

  return (
    <div className="space-y-2">
      {options.map((option) => {
        const isSelected = selected.has(option.id)
        return (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            onClick={() => toggle(option.id)}
            className={[
              'flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors',
              isSelected
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border bg-background hover:bg-muted',
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
            ].join(' ')}
          >
            <span
              className={[
                'flex h-4 w-4 shrink-0 items-center justify-center rounded border-2',
                isSelected ? 'border-primary bg-primary' : 'border-muted-foreground bg-background',
              ].join(' ')}
            >
              {isSelected && (
                <svg
                  className="h-3 w-3 text-primary-foreground"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <polyline points="2,6 5,9 10,3" />
                </svg>
              )}
            </span>
            <span>{option.text}</span>
          </button>
        )
      })}
    </div>
  )
}
