'use client'

import { useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { ImageOff, X, ZoomIn } from 'lucide-react'

interface TaskImageProps {
  src: string
  alt?: string | null
  width?: number | null
  height?: number | null
}

export function TaskImage({ src, alt, width, height }: TaskImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const altText = alt ?? 'Изображение к задаче'

  // Compute aspect ratio for skeleton placeholder
  const aspectStyle =
    width && height
      ? { aspectRatio: `${width} / ${height}` }
      : { aspectRatio: '4 / 3' }

  return (
    <>
      <div
        className="relative max-w-full overflow-hidden rounded-md border bg-muted"
        style={aspectStyle}
      >
        {status === 'loading' && (
          <Skeleton className="absolute inset-0 w-full h-full rounded-md" />
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageOff className="h-8 w-8" />
            <span className="text-xs">Изображение недоступно</span>
          </div>
        )}

        {src && (
          <img
            src={src}
            alt={altText}
            loading="lazy"
            className={[
              'w-full h-full object-contain transition-opacity duration-200 cursor-zoom-in',
              status === 'loaded' ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
            onLoad={() => setStatus('loaded')}
            onError={() => setStatus('error')}
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
