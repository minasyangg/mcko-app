'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

// Ключ синхронизирован с rememberAddTarget в TestDetailClient и предвыбором
// в AddToTestDialog.
const KEY = 'mcko:add-to-test'
const MAX_AGE = 2 * 60 * 60 * 1000 // 2 часа

type Target = { testId: string; title: string }

function readTarget(): Target | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as { testId?: string; title?: string; ts?: number }
    if (t.testId && Date.now() - (t.ts ?? 0) < MAX_AGE) {
      return { testId: t.testId, title: t.title || 'заданию' }
    }
  } catch { /* sessionStorage недоступен */ }
  return null
}

// Баннер «вернуться к заданию, откуда учитель пришёл подбирать задачи».
// Показывается в книгах/библиотеке, только если есть свежая цель добавления.
export function AddTargetBanner({ compact = false }: { compact?: boolean }) {
  const [target, setTarget] = useState<Target | null>(null)

  useEffect(() => { setTarget(readTarget()) }, [])

  if (!target) return null

  const href = `/teacher/tests/${target.testId}`
  // клик по возврату очищает цель — работа с подбором завершена
  const clear = () => { try { sessionStorage.removeItem(KEY) } catch { /* ignore */ } }

  if (compact) {
    return (
      <Button asChild variant="ghost" size="sm" className="h-7 -ml-2 px-2 text-primary">
        <Link href={href} onClick={clear}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> К заданию
        </Link>
      </Button>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
      <span className="text-muted-foreground min-w-0">
        Добавляете задания в: <span className="font-medium text-foreground">{target.title}</span>
      </span>
      <Button asChild size="sm" variant="outline" onClick={clear}>
        <Link href={href}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Вернуться к заданию
        </Link>
      </Button>
    </div>
  )
}
