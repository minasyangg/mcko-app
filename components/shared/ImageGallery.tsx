'use client'

import { useState } from 'react'
import { X, ChevronLeft, ChevronRight, ZoomIn } from 'lucide-react'

interface GalleryImage {
  id: string
  signedUrl: string
  alt?: string | null
  sort_order: number
}

interface Props {
  images: GalleryImage[]
  onDelete?: (id: string) => void
  uploading?: boolean
  uploadSlot?: React.ReactNode
}

export function ImageGallery({ images, onDelete, uploadSlot }: Props) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const sorted = [...images].sort((a, b) => a.sort_order - b.sort_order)
  const isMany = sorted.length > 2

  function openLightbox(idx: number) { setLightboxIdx(idx) }
  function closeLightbox() { setLightboxIdx(null) }
  function prev() { setLightboxIdx(i => (i == null ? 0 : (i - 1 + sorted.length) % sorted.length)) }
  function next() { setLightboxIdx(i => (i == null ? 0 : (i + 1) % sorted.length)) }

  return (
    <>
      <div className={`flex flex-wrap gap-2 items-start ${isMany ? 'max-h-72 overflow-y-auto pr-1' : ''}`}>
        {sorted.map((img, idx) => (
          <div key={img.id} className="relative group shrink-0">
            <div
              className="relative cursor-zoom-in"
              onClick={() => openLightbox(idx)}
              title="Нажмите для увеличения"
            >
              <img
                src={img.signedUrl}
                alt={img.alt ?? `Изображение ${idx + 1}`}
                className={`rounded border object-contain bg-white ${isMany ? 'h-24 w-auto max-w-[140px]' : 'h-36 w-auto max-w-xs'}`}
              />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="bg-black/40 rounded-full p-1">
                  <ZoomIn className="h-4 w-4 text-white" />
                </div>
              </div>
            </div>
            {onDelete && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(img.id) }}
                className="absolute -top-1.5 -right-1.5 hidden group-hover:flex items-center justify-center h-5 w-5 rounded-full bg-destructive text-destructive-foreground shadow z-10"
                title="Удалить"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        {uploadSlot}
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && sorted[lightboxIdx] && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
          onClick={closeLightbox}
        >
          <button
            onClick={(e) => { e.stopPropagation(); closeLightbox() }}
            className="absolute top-4 right-4 text-white hover:text-white/70 transition-colors"
          >
            <X className="h-7 w-7" />
          </button>

          {sorted.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); prev() }}
                className="absolute left-4 text-white hover:text-white/70 transition-colors p-2"
              >
                <ChevronLeft className="h-8 w-8" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); next() }}
                className="absolute right-4 text-white hover:text-white/70 transition-colors p-2"
              >
                <ChevronRight className="h-8 w-8" />
              </button>
            </>
          )}

          <div className="max-w-4xl max-h-[85vh] flex flex-col items-center gap-2" onClick={e => e.stopPropagation()}>
            <img
              src={sorted[lightboxIdx].signedUrl}
              alt={sorted[lightboxIdx].alt ?? `Изображение ${lightboxIdx + 1}`}
              className="max-h-[78vh] max-w-full object-contain rounded shadow-xl"
            />
            {sorted.length > 1 && (
              <span className="text-white/70 text-sm">{lightboxIdx + 1} / {sorted.length}</span>
            )}
          </div>
        </div>
      )}
    </>
  )
}
