'use client'

import { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

// Тонкая полоса загрузки вверху экрана, пока идёт переход на другую страницу.
// Нужна прежде всего на телефоне: страница, которую Next ещё не успел
// предзагрузить (ссылки в мобильном меню монтируются только при его
// открытии), иначе секунду-другую не меняется вовсе, и тап по разделу
// выглядит несработавшим.
//
// Старт — клик по любой внутренней ссылке (обработчик на document в фазе
// перехвата: next/link сам вызывает preventDefault, поэтому defaultPrevented
// здесь ничего не говорит). Конец — смена адреса (pathname/query).
export function NavigationProgress() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const url = `${pathname}?${searchParams.toString()}`
  const [pending, setPending] = useState(false)

  // Переход завершился — адрес сменился. Сброс прямо в рендере, а не в
  // эффекте: тот же факт без лишнего прохода рендера (react.dev, «adjusting
  // some state when a prop changes»).
  const [prevUrl, setPrevUrl] = useState(url)
  if (prevUrl !== url) {
    setPrevUrl(url)
    setPending(false)
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const target = e.target as Element | null
      const a = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.hasAttribute('download')) return
      if (a.target && a.target !== '_self') return
      const next = new URL(a.href, window.location.href)
      if (next.origin !== window.location.origin) return
      // Та же страница (в т.ч. переход по #якорю) — загрузки не будет
      if (next.pathname === window.location.pathname && next.search === window.location.search) return
      setPending(true)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  // Страховка: если переход так и не состоялся (обработчик ссылки сам его
  // отменил), полоса не должна висеть бесконечно.
  useEffect(() => {
    if (!pending) return
    const t = setTimeout(() => setPending(false), 15000)
    return () => clearTimeout(t)
  }, [pending])

  return (
    <div
      aria-hidden
      data-pending={pending}
      className="nav-progress pointer-events-none fixed inset-x-0 top-0 z-[200] h-[3px]"
    >
      <div className="nav-progress-bar h-full rounded-r-full bg-primary" />
    </div>
  )
}
