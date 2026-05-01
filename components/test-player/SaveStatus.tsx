'use client'

import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react'

interface SaveStatusProps {
  status: 'idle' | 'saving' | 'saved' | 'error'
}

export function SaveStatus({ status }: SaveStatusProps) {
  if (status === 'idle') return null

  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {status === 'saving' && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Сохранение...</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          <span className="text-green-600 dark:text-green-400">Сохранено</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="h-3.5 w-3.5 text-destructive" />
          <span className="text-destructive">Ошибка сохранения</span>
        </>
      )}
    </span>
  )
}
