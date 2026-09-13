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

  // Reset whenever the source array changes (e.g., filter applied) —
  // иначе после смены фильтра/вкладки видно N строк от предыдущего набора
  useEffect(() => setShown(initialSize), [items, initialSize])

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

  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) onLoadMore() },
      { rootMargin: '300px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [onLoadMore, enabled])

  return ref
}
