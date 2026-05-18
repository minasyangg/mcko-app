'use client'

import { useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'

interface TimerProps {
  startedAt: string | null
  timeLimitSec: number
  onExpire: () => void
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds)
  const mm = Math.floor(s / 60).toString().padStart(2, '0')
  const ss = (s % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

export function Timer({ startedAt, timeLimitSec, onExpire }: TimerProps) {
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire

  const [remaining, setRemaining] = useState<number>(() => {
    if (!startedAt) return timeLimitSec
    const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
    return Math.max(0, timeLimitSec - elapsed)
  })

  const expiredRef = useRef(false)

  useEffect(() => {
    if (remaining <= 0 && !expiredRef.current) {
      expiredRef.current = true
      onExpireRef.current()
      return
    }

    const interval = setInterval(() => {
      setRemaining((prev) => {
        const next = prev - 1
        if (next <= 0 && !expiredRef.current) {
          expiredRef.current = true
          clearInterval(interval)
          onExpireRef.current()
          return 0
        }
        return next
      })
    }, 1000)

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isLow = remaining < 60
  const isWarning = remaining < 300

  return (
    <span
      suppressHydrationWarning
      className={[
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-mono font-medium tabular-nums',
        isLow
          ? 'bg-destructive/10 text-destructive'
          : isWarning
          ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
          : 'bg-muted text-foreground',
      ].join(' ')}
    >
      <Clock className="h-3.5 w-3.5" />
      {formatTime(remaining)}
    </span>
  )
}
