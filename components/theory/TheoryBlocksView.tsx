'use client'

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import MarkdownContent from '@/components/shared/MarkdownContent'
import type { TheoryBlock } from '@/lib/theory/types'
import { cn } from '@/lib/utils'

type ViewBlock = Pick<TheoryBlock, 'id' | 'title' | 'content_md' | 'source_ref'>

// Вывод теории — общий для ученика (карточка, боковая панель, страница
// результата) и для просмотра у учителя. Рендер тот же, что у заданий
// (MarkdownContent: KaTeX, таблицы, картинки, ```graph/```chart).
//
// Несколько блоков у ДЗ — вкладки «1. …», «2. …» в порядке, заданном
// учителем: один блок на экране вместо длинной простыни, внизу кнопка
// «Далее» к следующему блоку. На телефоне вкладки прокручиваются вбок.
//
// Строки вида «А) …» и «1) …» в теории не использовать: MarkdownContent
// перестраивает такой текст в таблицу соответствия (reformatMatchingTask).
export function TheoryBlocksView({ blocks }: { blocks: ViewBlock[] }) {
  const [active, setActive] = useState(0)
  if (blocks.length === 0) return null
  if (blocks.length === 1) return <BlockBody block={blocks[0]} />

  const idx = Math.min(active, blocks.length - 1)
  const current = blocks[idx]
  const next = blocks[idx + 1]

  return (
    <div className="space-y-4">
      {/* на телефоне вкладки листаются вбок, на широком экране переносятся */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible" role="tablist" aria-label="Разделы теории">
        {blocks.map((b, i) => (
          <button
            key={b.id}
            type="button"
            role="tab"
            aria-selected={i === idx}
            onClick={() => setActive(i)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-sm transition-colors',
              i === idx
                ? 'border-sky-500 bg-sky-500 text-white'
                : 'border-border bg-background text-muted-foreground hover:bg-muted',
            )}
          >
            {i + 1}. {b.title}
          </button>
        ))}
      </div>

      <h3 className="text-base font-semibold">{idx + 1}. {current.title}</h3>
      <BlockBody block={current} />

      {next && (
        <button
          type="button"
          onClick={() => setActive(idx + 1)}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-sky-200 bg-sky-50/50 px-3 py-2 text-left text-sm text-sky-800 hover:bg-sky-50 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200"
        >
          <span className="min-w-0 truncate">Далее: {idx + 2}. {next.title}</span>
          <ArrowRight className="h-4 w-4 shrink-0" />
        </button>
      )}
    </div>
  )
}

function BlockBody({ block }: { block: ViewBlock }) {
  return (
    <section className="space-y-2">
      <MarkdownContent content={block.content_md} />
      {block.source_ref && (
        <p className="pt-1 text-xs text-muted-foreground">Подробнее: {block.source_ref}</p>
      )}
    </section>
  )
}
