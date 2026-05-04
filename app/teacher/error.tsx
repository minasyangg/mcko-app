'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

export default function TeacherError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[TeacherError]', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive opacity-70" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Что-то пошло не так</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Произошла ошибка при загрузке страницы. Попробуйте ещё раз.
        </p>
      </div>
      <Button onClick={reset} variant="outline" size="sm">
        Попробовать снова
      </Button>
    </div>
  )
}
