import { useState, useEffect, useRef, useCallback } from 'react'

const PAGE_SIZE = 25

/**
 * Client-side pagination with IntersectionObserver auto-load and manual
 * "load more". `initialSize` — сколько строк показать сразу (по умолчанию
 * равен `step`); `step` — на сколько строк вырастает список по каждому
 * "показать ещё"/докрутке колесом. Разные значения нужны, когда первый
 * экран и шаг подгрузки заданы отдельно (напр. Результаты: сразу 20, потом
 * по 10).
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

/** Attach to a sentinel div — fires onLoadMore when it enters the viewport. */
export function useScrollTrigger(onLoadMore: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)

  // onLoadMore держим в ref, а не в зависимостях эффекта. usePagination
  // отдаёт loadMore через useCallback(..., [hasMore, step]) — hasMore меняется
  // на каждый шаг подгрузки, значит loadMore получает новую identity почти
  // на каждом рендере. Раньше это стояло в зависимостях [onLoadMore, enabled]:
  // эффект пересоздавал IntersectionObserver на каждый такой рендер, а
  // IntersectionObserver вызывает callback сразу при observe(), если сентинел
  // уже пересекает зону (rootMargin: 300px — на невысоких списках это верно
  // с самого начала). Итог: подгрузка → новый loadMore → новый observer →
  // немедленный повторный вызов → снова подгрузка → ... — список долистывался
  // до конца сам, без единого скролла или клика, выглядя так, будто пагинации
  // нет вовсе. Обсервер должен жить, пока не размонтирован/не сменился enabled,
  // и звать всегда самую свежую функцию — не пересоздаваясь из-за неё самой.
  const onLoadMoreRef = useRef(onLoadMore)
  useEffect(() => { onLoadMoreRef.current = onLoadMore })

  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return
    // Один живой observer на весь срок enabled=true — не пересоздаётся при
    // каждой подгрузке (см. комментарий выше). wasIntersecting — защёлка
    // «зови onLoadMore только на ПЕРЕХОД в зону, не на каждое срабатывание
    // с isIntersecting=true»: если весь список и так помещается на экране
    // (короткий список — ровно случай, где баг был заметнее всего), сентинел
    // остаётся в зоне и после подгрузки порции, а браузер не гарантирует, что
    // не пришлёт повторный entry с тем же isIntersecting при пересчёте
    // layout — без защёлки это снова выглядело бы как самостоятельная
    // докрутка до конца без участия пользователя.
    let wasIntersecting = false
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !wasIntersecting) onLoadMoreRef.current()
        wasIntersecting = entry.isIntersecting
      },
      { rootMargin: '300px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [enabled])

  return ref
}
