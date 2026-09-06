import { useEffect, useRef, useState } from 'react'

// Единый механизм «живого» обновления для всего проекта. Supabase Realtime
// НЕ используем: publication supabase_realtime пуста (проверено 2026-09-06,
// select tablename from pg_publication_tables where pubname='supabase_realtime'
// → 0 строк) — postgres_changes подписки молча ничего не делают, без ошибки.
// См. память feedback_realtime_badges.
//
// Приём один и тот же везде: опрос с фиксированным шагом + мгновенное
// обновление при возврате фокуса на вкладку (сценарий «сделал в другой
// вкладке/на телефоне, вернулся сюда»).

/** Опрос с разумным шагом по умолчанию — компромисс между свежестью данных и
 *  числом запросов для событий, которые случаются не поминутно (заявки,
 *  сдача работ на проверку и т.п.). */
export const DEFAULT_POLL_MS = 60_000

/**
 * Периодически вызывает `fetcher`, плюс сразу при монтировании и при
 * возврате фокуса на вкладку. Не вызывает fetcher параллельно с самим собой
 * (актуально для focus сразу после планового тика).
 *
 * `enabled=false` полностью останавливает опрос (например, для не-админа).
 */
export function usePolling(fetcher: () => void | Promise<void>, opts?: { intervalMs?: number; enabled?: boolean }) {
  const intervalMs = opts?.intervalMs ?? DEFAULT_POLL_MS
  const enabled = opts?.enabled ?? true
  // ref, а не замыкание — чтобы менять fetcher между рендерами, не пересоздавая
  // таймер. Запись в отдельном эффекте, а не прямо в теле хука: мутировать
  // ref.current во время рендера запрещено (react-hooks/refs).
  const fetcherRef = useRef(fetcher)
  useEffect(() => { fetcherRef.current = fetcher })

  useEffect(() => {
    if (!enabled) return
    let inFlight = false
    const run = () => {
      if (inFlight) return
      inFlight = true
      Promise.resolve(fetcherRef.current()).finally(() => { inFlight = false })
    }

    run()
    const timer = setInterval(run, intervalMs)
    window.addEventListener('focus', run)

    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', run)
    }
  }, [intervalMs, enabled])
}

/** Частный случай usePolling: счётчик с одного JSON-роута вида `{ count: number }`
 *  (бейджи «на модерации», «на проверке» и т.п.). */
export function useLiveCount(url: string, opts?: { initial?: number; intervalMs?: number; enabled?: boolean }) {
  const [count, setCount] = useState(opts?.initial ?? 0)

  usePolling(async () => {
    try {
      const res = await fetch(url)
      if (!res.ok) return
      const json = await res.json()
      setCount(json.count ?? 0)
    } catch { /* сеть моргнула — счётчик обновится следующим тиком */ }
  }, { intervalMs: opts?.intervalMs, enabled: opts?.enabled })

  return count
}
