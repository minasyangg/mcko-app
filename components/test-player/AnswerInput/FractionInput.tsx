'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface FractionInputProps {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}

interface ParsedFraction {
  mode: 'simple' | 'mixed'
  whole: string
  num: string
  den: string
}

function parseValue(value: string): ParsedFraction {
  const trimmed = value.trim()
  const mixed = trimmed.match(/^(-?\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) return { mode: 'mixed', whole: mixed[1], num: mixed[2], den: mixed[3] }
  const simple = trimmed.match(/^(-?\d+)\/(\d+)$/)
  if (simple) return { mode: 'simple', whole: '', num: simple[1], den: simple[2] }
  return { mode: 'simple', whole: '', num: '', den: '' }
}

// Ввод обыкновенной/смешанной дроби двумя-тремя ячейками (числитель над
// знаменателем, у смешанной — ещё целая часть слева). Собирает каноническую
// строку "num/den" или "whole num/den" — формат хранения ответа не
// меняется, это только альтернативный способ набрать то же значение, что
// приходило бы через десятичный Numeric.
export function FractionInput({ value, onChange, disabled }: FractionInputProps) {
  const [mode, setMode] = useState<'simple' | 'mixed'>(() => parseValue(value).mode)
  const [whole, setWhole] = useState(() => parseValue(value).whole)
  const [num, setNum] = useState(() => parseValue(value).num)
  const [den, setDen] = useState(() => parseValue(value).den)

  // Синхронизация с внешними изменениями value (сброс ответа, знак ±),
  // но не перетирает то, что уже набрано в ячейках — сверяет с тем, что
  // сами ячейки сейчас составили бы, и перепарсивает только при расхождении.
  useEffect(() => {
    const composed = mode === 'mixed' ? `${whole || '0'} ${num}/${den}` : `${num}/${den}`
    if (value !== composed) {
      const p = parseValue(value)
      setMode(p.mode)
      setWhole(p.whole)
      setNum(p.num)
      setDen(p.den)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function push(nextWhole: string, nextNum: string, nextDen: string, nextMode: 'simple' | 'mixed') {
    onChange(nextMode === 'mixed' ? `${nextWhole || '0'} ${nextNum}/${nextDen}` : `${nextNum}/${nextDen}`)
  }

  function handleModeChange(nextMode: 'simple' | 'mixed') {
    setMode(nextMode)
    push(whole, num, den, nextMode)
  }

  const cellClass = 'h-8 w-16 text-center px-1'

  return (
    <div className="space-y-2">
      <div className="inline-flex rounded-md border border-input p-0.5 text-xs">
        <button
          type="button"
          onClick={() => handleModeChange('simple')}
          disabled={disabled}
          className={cn(
            'rounded px-2 py-1 font-medium transition-colors',
            mode === 'simple' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Простая дробь
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('mixed')}
          disabled={disabled}
          className={cn(
            'rounded px-2 py-1 font-medium transition-colors',
            mode === 'mixed' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Смешанное число
        </button>
      </div>

      <div className="flex items-center gap-2">
        {mode === 'mixed' && (
          <Input
            type="text"
            inputMode="numeric"
            value={whole}
            onChange={(e) => { setWhole(e.target.value); push(e.target.value, num, den, mode) }}
            disabled={disabled}
            placeholder="цел."
            className={cellClass}
          />
        )}
        <div className="flex flex-col items-stretch">
          <Input
            type="text"
            inputMode="numeric"
            value={num}
            onChange={(e) => { setNum(e.target.value); push(whole, e.target.value, den, mode) }}
            disabled={disabled}
            placeholder="числ."
            className={cn(cellClass, 'rounded-b-none border-b-0')}
          />
          <div className="border-t border-foreground" />
          <Input
            type="text"
            inputMode="numeric"
            value={den}
            onChange={(e) => { setDen(e.target.value); push(whole, num, e.target.value, mode) }}
            disabled={disabled}
            placeholder="знам."
            className={cn(cellClass, 'rounded-t-none')}
          />
        </div>
      </div>
    </div>
  )
}
