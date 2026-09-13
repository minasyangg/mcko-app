'use client'

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

// Кнопка «Показать ещё N» для любого клиентски пагинируемого списка
// (usePagination). Раньше JSX этого блока был скопирован в ResultsClient —
// теперь один компонент на все списки (Мониторинг, Тесты/ДЗ, Ученики, Группы
// и т.д.), чтобы подгрузка выглядела и вела себя одинаково везде.
//
// Автоподгрузка по скроллу отсюда убрана намеренно: сентинел под таблицей
// попадал в зону IntersectionObserver сразу на первом рендере (короткому
// списку из 15 строк некуда уходить за сгиб), список долистывался до конца
// сам и пагинация выглядела нерабочей. Подробнее — в lib/hooks/usePagination.
export function LoadMoreControl({ hasMore, loadMore, remaining, step, totalLabel }: Props) {
  if (!hasMore) {
    return totalLabel
      ? <p className="text-center text-xs text-muted-foreground pt-2">{totalLabel}</p>
      : null
  }

  const shown = step ?? remaining

  return (
    <div className="flex flex-col items-center gap-3 pt-2">
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
