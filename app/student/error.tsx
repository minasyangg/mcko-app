'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

export default function StudentError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[StudentError]', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center px-4">
      <AlertTriangle className="h-10 w-10 text-destructive opacity-70" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Ошибка загрузки</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Не удалось загрузить страницу. Проверьте соединение и попробуйте снова.
        </p>
      </div>
      <Button onClick={reset} variant="outline" size="sm">
        Повторить
      </Button>
    </div>
  )
}
