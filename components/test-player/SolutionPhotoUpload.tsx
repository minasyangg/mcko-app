'use client'

import { useRef, useState } from 'react'
import { Camera, Loader2, X, ImageOff, ZoomIn } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface SolutionPhoto {
  id: string
  sort_order: number
  url: string
}

const MAX_PHOTOS = 2

interface Props {
  attemptId: string
  taskId: string
  photos: SolutionPhoto[]
  onChange: (photos: SolutionPhoto[]) => void
  disabled?: boolean
}

// Прикрепление фото письменного решения (черновик на бумаге) прямо к
// заданию в симуляторе теста — для заданий второй части экзамена, где
// ответ нельзя свести к короткому тексту/выбору и учителю нужно видеть ход
// решения. Не более MAX_PHOTOS штук; сервер сам сжимает (sharp → webp) —
// см. app/api/attempts/[id]/tasks/[taskId]/solution-media/route.ts.
export function SolutionPhotoUpload({ attemptId, taskId, photos, onChange, disabled }: Props) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canAddMore = photos.length < MAX_PHOTOS

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // тот же файл можно выбрать повторно после ошибки
    if (!file) return

    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/attempts/${attemptId}/tasks/${taskId}/solution-media`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Не удалось загрузить фото')
        return
      }
      onChange(
        [...photos, { id: data.id, sort_order: data.sort_order, url: data.signedUrl }]
          .sort((a, b) => a.sort_order - b.sort_order)
      )
    } catch {
      setError('Не удалось загрузить фото — проверьте соединение')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(photoId: string) {
    setError(null)
    // Optimistic: убираем сразу, откатываем при ошибке
    const prev = photos
    onChange(photos.filter((p) => p.id !== photoId))
    try {
      const res = await fetch(
        `/api/attempts/${attemptId}/tasks/${taskId}/solution-media?media_id=${photoId}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Не удалось удалить фото')
        onChange(prev)
      }
    } catch {
      setError('Не удалось удалить фото — проверьте соединение')
      onChange(prev)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {photos.map((photo) => (
          <div key={photo.id} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border group">
            {photo.url ? (
              <div
                className="relative h-full w-full cursor-zoom-in"
                onClick={() => setLightboxUrl(photo.url)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URL, миниатюра фиксированного размера, next/image здесь не даёт выгоды */}
                <img src={photo.url} alt="Фото решения" className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <ZoomIn className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                <ImageOff className="h-5 w-5" />
              </div>
            )}
            {!disabled && (
              <button
                type="button"
                onClick={() => handleDelete(photo.id)}
                className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5 shadow-sm hover:bg-destructive hover:text-destructive-foreground"
                title="Удалить фото"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}

        {!disabled && canAddMore && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Camera className="mr-1.5 h-3.5 w-3.5" />}
            {photos.length === 0 ? 'Прикрепить фото решения' : 'Добавить ещё фото'}
          </Button>
        )}
      </div>

      {!disabled && (
        <>
          <p className="text-xs text-muted-foreground">
            Сфотографируйте письменное решение (до {MAX_PHOTOS} фото) — учитель увидит его при проверке.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileSelected}
          />
        </>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- полноэкранный лайтбокс поверх фиксированного оверлея, тот же паттерн что AttemptDrawer.ImageThumb */}
          <img
            src={lightboxUrl}
            alt="Фото решения"
            className="max-w-full max-h-[90vh] object-contain rounded shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
