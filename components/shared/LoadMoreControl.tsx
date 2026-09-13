'use client'

import { useScrollTrigger } from '@/lib/hooks/usePagination'
import { Button } from '@/components/ui/button'

interface Props {
  hasMore: boolean
  loadMore: () => void
  /** Сколько строк ещё не показано — подставляется в подпись кнопки */
  remaining: number
  /** «Показать ещё 10» вместо дефолтного «Ещё (N строк)» — когда шаг
   * пагинации отличается от remaining (кнопка всегда грузит фиксированный
   * шаг, а не «все оставшиеся»). Если не задан, используется remaining. */
  step?: number
  /** Показать «Показано всего N …» под списком, когда докручивать больше
   * нечего — тем же текстом, что уже сложился в ResultsClient. */
  totalLabel?: string
}

// Единая пара «докрутить колесом» + «нажать кнопку» для любого клиентски
// пагинируемого списка (usePagination). Раньше JSX этого блока был скопирован
// в ResultsClient — теперь один компонент на все списки, которые внедряет
// эта задача (Мониторинг, Тесты/ДЗ, Ученики, Группы и т.д.), чтобы кнопка
// и авто-подгрузка колесом мыши выглядели и вели себя одинаково везде.
export function LoadMoreControl({ hasMore, loadMore, remaining, step, totalLabel }: Props) {
  const scrollRef = useScrollTrigger(loadMore, hasMore)

  if (!hasMore) {
    return totalLabel
      ? <p className="text-center text-xs text-muted-foreground pt-2">{totalLabel}</p>
      : null
  }

  const shown = step ?? remaining

  return (
    <div className="flex flex-col items-center gap-3 pt-2">
      {/* Сентинел для автоподгрузки на десктопе (колесо/скролл) */}
      <div ref={scrollRef} />
      {/* Кнопка — основной способ на тач-устройствах, где авто-подгрузка
          скроллом менее заметна, и явный запасной вариант везде */}
      <Button
        variant="outline"
        size="sm"
        onClick={loadMore}
        className="w-full sm:w-auto"
      >
        Показать ещё {shown}
      </Button>
    </div>
  )
}
