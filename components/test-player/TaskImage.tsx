'use client'

import { useState, useEffect, useRef } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { ImageOff, X, ZoomIn } from 'lucide-react'

// Паузы между повторами. Первая короткая — обычный сетевой сбой переживается
// незаметно для ученика; дальше отступаем, чтобы не долбить хранилище.
const RETRY_DELAYS = [300, 1000, 3000]

interface TaskImageProps {
  src: string
  alt?: string | null
  width?: number | null
  height?: number | null
  /** First visible image — eager load + high fetch priority */
  priority?: boolean
}

export function TaskImage({ src, alt, width, height, priority = false }: TaskImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [lightboxOpen, setLightboxOpen] = useState(false)
  // Incrementing this key causes React to remount <img>, triggering a fresh fetch
  const [retryKey, setRetryKey] = useState(0)
  const attempts = useRef(0)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const altText = alt ?? 'Изображение к задаче'
  const aspectStyle =
    width && height ? { aspectRatio: `${width} / ${height}` } : { aspectRatio: '4 / 3' }

  useEffect(() => {
    // Пустой src — картинке неоткуда взяться (не сформировался URL), повторять
    // нечего: показываем ошибку сразу.
    if (!src) {
      console.error(`[TaskImage] Пустой src — URL не сформирован, ${new Date().toISOString()}`)
      setStatus('error')
      return
    }
    setStatus('loading')
    setRetryKey(0)
    attempts.current = 0
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [src])

  // Повторы с нарастающей паузой. Раньше была одна попытка через 1.5с: при
  // обычном сетевом сбое её не хватало, а полторы секунды ожидания посреди
  // контрольной уже заметны. Ссылки на task-media постоянные (бакет публичный),
  // поэтому ошибка почти всегда сетевая — её и переживаем.
  function handleError() {
    if (attempts.current < RETRY_DELAYS.length) {
      const delay = RETRY_DELAYS[attempts.current]
      attempts.current += 1
      if (retryTimer.current) clearTimeout(retryTimer.current)
      retryTimer.current = setTimeout(() => {
        setStatus('loading')
        setRetryKey((k) => k + 1)
      }, delay)
    } else {
      console.error(`[TaskImage] Не удалось загрузить после ${RETRY_DELAYS.length} повторов — ${new Date().toISOString()} — src: ${src}`)
      setStatus('error')
    }
  }

  return (
    <>
      <div
        className="relative max-w-full overflow-hidden rounded-md border bg-muted"
        style={{ ...aspectStyle, maxHeight: '320px' }}
      >
        {status === 'loading' && src && (
          <Skeleton className="absolute inset-0 w-full h-full rounded-md" />
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageOff className="h-8 w-8" />
            <span className="text-xs text-center px-2">Изображение недоступно</span>
            {/* Последнее слово за учеником: автоповторы кончились, но сеть могла
                уже восстановиться — не заставляем перезагружать весь тест. */}
            <button
              type="button"
              onClick={() => {
                attempts.current = 0
                setStatus('loading')
                setRetryKey((k) => k + 1)
              }}
              className="text-xs underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Повторить
            </button>
          </div>
        )}

        {src && (
          <img
            key={retryKey}
            src={src}
            alt={altText}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            decoding={priority ? 'sync' : 'async'}
            className={[
              'w-full h-full object-contain transition-opacity duration-200 cursor-zoom-in',
              status === 'loaded' ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
            onLoad={() => setStatus('loaded')}
            onError={handleError}
            onClick={() => status === 'loaded' && setLightboxOpen(true)}
          />
        )}

        {status === 'loaded' && (
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="absolute top-1.5 right-1.5 rounded bg-black/40 p-1 text-white opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity"
            aria-label="Открыть изображение"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {alt && (
        <p className="mt-1 text-xs text-muted-foreground text-center">{alt}</p>
      )}

      {/* Lightbox */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={src}
            alt={altText}
            className="max-w-full max-h-[90vh] object-contain rounded shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          {alt && (
            <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white/70">
              {alt}
            </p>
          )}
        </div>
      )}
    </>
  )
}
