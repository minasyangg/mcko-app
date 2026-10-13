'use client'

import { useState, useSyncExternalStore } from 'react'
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react'
import type { TheoryBlock } from '@/lib/theory/types'
import { TheoryBlocksView } from './TheoryBlocksView'

interface Props {
  blocks: TheoryBlock[]
  /** Развёрнута ли карточка, пока ученик сам её не свернул/развернул */
  defaultOpen?: boolean
  /** Ключ localStorage, чтобы помнить выбор ученика (например, по назначению) */
  storageKey?: string
}

function readStorage(key: string | undefined): string | null {
  if (!key) return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null // приватный режим / заблокированное хранилище
  }
}

function subscribeStorage(onChange: () => void) {
  window.addEventListener('storage', onChange)
  return () => window.removeEventListener('storage', onChange)
}

// Сворачиваемая карточка «Теория к уроку». Выбор «свернуть» запоминается в
// localStorage — это удобство конкретного браузера: без доступа к хранилищу
// карточка открывается в состоянии по умолчанию. Сохранённое значение
// читается через useSyncExternalStore: на сервере его нет (null), поэтому
// гидрация совпадает, а клиент сразу подхватывает выбор ученика.
export function TheoryCard({ blocks, defaultOpen = true, storageKey }: Props) {
  const saved = useSyncExternalStore(subscribeStorage, () => readStorage(storageKey), () => null)
  const [override, setOverride] = useState<boolean | null>(null)
  const open = override ?? (saved === '0' ? false : saved === '1' ? true : defaultOpen)

  function toggle() {
    const next = !open
    setOverride(next)
    if (!storageKey) return
    try {
      window.localStorage.setItem(storageKey, next ? '1' : '0')
    } catch {
      // не критично — выбор просто не запомнится
    }
  }

  if (blocks.length === 0) return null

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/40 dark:border-sky-900 dark:bg-sky-950/20">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <BookOpen className="h-4 w-4 shrink-0 text-sky-600" />
        <span className="flex-1 text-sm font-semibold">
          Теория к уроку
          {blocks.length > 1 && <span className="ml-1.5 font-normal text-muted-foreground">· разделов: {blocks.length}</span>}
        </span>
        <span className="text-xs text-muted-foreground">{open ? 'Свернуть' : 'Развернуть'}</span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t border-sky-200 px-4 py-4 dark:border-sky-900">
          <TheoryBlocksView blocks={blocks} />
        </div>
      )}
    </div>
  )
}
