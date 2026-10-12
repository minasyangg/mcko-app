import MarkdownContent from '@/components/shared/MarkdownContent'
import type { TheoryBlock } from '@/lib/theory/types'

// Вывод блоков теории — общий для ученика (карточка, боковая панель,
// страница результата) и для предпросмотра у учителя. Рендер тот же, что у
// заданий (MarkdownContent: KaTeX, таблицы, ленивые картинки).
//
// Строки вида «А) …» и «1) …» в теории не использовать: MarkdownContent
// перестраивает такой текст в таблицу соответствия (reformatMatchingTask).
export function TheoryBlocksView({ blocks }: { blocks: Pick<TheoryBlock, 'id' | 'title' | 'content_md' | 'source_ref'>[] }) {
  return (
    <div className="space-y-6">
      {blocks.map((b) => (
        <section key={b.id} className="space-y-2">
          {blocks.length > 1 && <h3 className="text-base font-semibold">{b.title}</h3>}
          <MarkdownContent content={b.content_md} />
          {b.source_ref && (
            <p className="pt-1 text-xs text-muted-foreground">Подробнее: {b.source_ref}</p>
          )}
        </section>
      ))}
    </div>
  )
}
