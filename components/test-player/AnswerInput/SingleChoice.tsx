'use client'

interface Option {
  id: string
  text: string
}

interface SingleChoiceProps {
  options: Option[]
  value: string | null
  onChange: (v: string) => void
  disabled?: boolean
}

export function SingleChoice({ options, value, onChange, disabled }: SingleChoiceProps) {
  return (
    <div className="space-y-2">
      {options.map((option) => {
        const isSelected = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.id)}
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
                'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                isSelected ? 'border-primary' : 'border-muted-foreground',
              ].join(' ')}
            >
              {isSelected && (
                <span className="h-2 w-2 rounded-full bg-primary" />
              )}
            </span>
            <span>{option.text}</span>
          </button>
        )
      })}
    </div>
  )
}
