'use client'

import { useEffect, useState } from 'react'
import { AlertDialogAction } from '@/components/ui/alert-dialog'

interface ConfirmDeleteActionProps {
  onConfirm: () => void
  loading?: boolean
  label?: string
  loadingLabel?: string
  seconds?: number
  className?: string
}

// Кнопка подтверждения безвозвратного удаления. Активируется не сразу, а
// через `seconds` секунд после открытия диалога (по умолчанию 3) — чтобы
// нельзя было машинально кликнуть «Удалить», не прочитав предупреждение.
// Диалог Radix размонтирует содержимое при закрытии, так что таймер сам
// сбрасывается при каждом новом открытии.
export function ConfirmDeleteAction({
  onConfirm,
  loading = false,
  label = 'Удалить',
  loadingLabel = 'Удаление...',
  seconds = 3,
  className = 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
}: ConfirmDeleteActionProps) {
  const [remaining, setRemaining] = useState(seconds)
  const ready = remaining <= 0

  useEffect(() => {
    if (ready) return
    const t = setTimeout(() => setRemaining((v) => v - 1), 1000)
    return () => clearTimeout(t)
  }, [remaining, ready])

  return (
    <AlertDialogAction
      onClick={(e) => {
        if (!ready) { e.preventDefault(); return }
        onConfirm()
      }}
      disabled={loading || !ready}
      className={className}
    >
      {loading ? loadingLabel : ready ? label : `${label} (${remaining})`}
    </AlertDialogAction>
  )
}
