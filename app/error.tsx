'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

// Ошибки страниц вне кабинетов (вход, регистрация, печать): у /student и
// /teacher свои error.tsx, сюда доходит только то, что они не перехватили.
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[RootError]', error)
  }, [error])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-4">
      <AlertTriangle className="h-10 w-10 text-destructive opacity-70" />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Что-то пошло не так</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          Не удалось загрузить страницу. Проверьте соединение и попробуйте ещё раз.
        </p>
      </div>
      <Button onClick={reset} variant="outline" size="sm">
        Попробовать снова
      </Button>
    </div>
  )
}
