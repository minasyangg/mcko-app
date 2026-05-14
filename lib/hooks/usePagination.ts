import { useState, useEffect, useRef, useCallback } from 'react'

const PAGE_SIZE = 25

/** Client-side pagination with IntersectionObserver auto-load and manual "load more". */
export function usePagination<T>(items: T[], pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(1)

  // Reset to first page whenever the source array changes (e.g., filter applied)
  useEffect(() => setPage(1), [items])

  const visible = items.slice(0, page * pageSize)
  const hasMore = visible.length < items.length
  const loadMore = useCallback(() => {
    if (hasMore) setPage((p) => p + 1)
  }, [hasMore])

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
