import { useState, useEffect, useRef, useCallback } from 'react'

const PAGE_SIZE = 25

/**
 * Клиентская пагинация списка: показываем первые `initialSize` строк, дальше
 * растём на `step` по каждому нажатию «Показать ещё». `initialSize` по
 * умолчанию равен `step`; разные значения нужны, когда первый экран и шаг
 * подгрузки заданы отдельно (напр. Результаты: сразу 20, потом по 10).
 *
 * Подгрузка ТОЛЬКО по явному нажатию кнопки. Автоподгрузка по скроллу здесь
 * была и оказалась несовместима с задачей: сентинел под таблицей попадал в
 * зону наблюдения IntersectionObserver (rootMargin 300px) сразу на первом
 * рендере — список из 15 строк ниже сгиба не уходит, скроллить нечего, — и
 * список долистывался до конца сам, до первой отрисовки. Выглядело так, будто
 * пагинации нет вовсе. Смысл пагинации здесь — меньше строк на странице по
 * умолчанию, поэтому «дозагрузить незаметно для пользователя» противоречит
 * самой цели.
 */
export function usePagination<T>(items: T[], step = PAGE_SIZE, initialSize = step) {
  const [shown, setShown] = useState(initialSize)

  // Сброс при смене фильтра/вкладки — но НЕ на каждый рендер. Раньше здесь
  // стояла зависимость [items, ...]: `items` почти everywhere приходит как
  // .filter()/.map() без useMemo у вызывающего компонента, то есть это
  // НОВЫЙ массив по ссылке на каждом рендере, даже с тем же содержимым.
  // Клик «показать ещё» → setShown увеличивает shown → компонент
  // перерендеривается → items пересоздаётся заново по ссылке → этот эффект
  // видел «новый items» и тут же откатывал shown обратно на initialSize —
  // клик выглядел так, будто вообще ничего не произошло.
  // items.length — куда более стабильный сигнал «список действительно
  // другой» (сменили вкладку/применили фильтр), чем ссылочное равенство.
  const itemsLength = items.length
  const prevLengthRef = useRef(itemsLength)
  useEffect(() => {
    if (prevLengthRef.current !== itemsLength) {
      prevLengthRef.current = itemsLength
      setShown(initialSize)
    }
  }, [itemsLength, initialSize])

  const visible = items.slice(0, shown)
  const hasMore = visible.length < items.length
  const loadMore = useCallback(() => {
    if (hasMore) setShown((s) => s + step)
  }, [hasMore, step])

  return { visible, hasMore, loadMore, total: items.length, showing: visible.length }
}

