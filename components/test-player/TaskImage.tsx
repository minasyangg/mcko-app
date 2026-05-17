'use client'

import { useState, useEffect, useRef } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { ImageOff, X, ZoomIn } from 'lucide-react'

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
  const retried = useRef(false)

  const altText = alt ?? 'Изображение к задаче'
  const aspectStyle =
    width && height ? { aspectRatio: `${width} / ${height}` } : { aspectRatio: '4 / 3' }

  useEffect(() => {
    // Empty src (failed signed URL generation) → show error immediately, no retry
    if (!src) {
      console.error(`[TaskImage] Empty src — signed URL generation failed at ${new Date().toISOString()}`)
      setStatus('error')
      return
    }
    setStatus('loading')
    setRetryKey(0)
    retried.current = false
  }, [src])

  function handleError() {
    if (!retried.current) {
      retried.current = true
      console.error(`[TaskImage] Load failed, retrying in 1.5s — ${new Date().toISOString()} — src: ${src}`)
      setTimeout(() => {
        setStatus('loading')
        setRetryKey((k) => k + 1)
      }, 1500)
    } else {
      console.error(`[TaskImage] Retry failed — likely expired signed URL — ${new Date().toISOString()} — src: ${src}`)
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
