'use client'

import { useRef, useState } from 'react'
import { AlertTriangle, Camera, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ConfirmDeleteAction } from '@/components/shared/ConfirmDeleteAction'
import { TaskImage } from './TaskImage'

export interface SolutionPhoto {
  id: string
  sort_order: number
  url: string
}

const MAX_PHOTOS = 2
// Серверный предел — 20 МБ (см. route.ts). Проверяем и на клиенте, чтобы не
// гнать по мобильному интернету файл, который всё равно будет отвергнут:
// на школьном 3G загрузка 20 МБ занимает минуты, и узнать об отказе в конце —
// худшее, что может случиться посреди контрольной.
const MAX_FILE_BYTES = 20 * 1024 * 1024

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
//
// Показ фото — через TaskImage (эталон из AGENTS.md): у него уже есть
// повторы при сетевом сбое, заглушка «Изображение недоступно» с кнопкой
// «Повторить» и лайтбокс. Для ученика на школьной сети это критичнее, чем
// где-либо ещё: свой же черновик, не загрузившийся молча, читается как
// «работа пропала».
export function SolutionPhotoUpload({ attemptId, taskId, photos, onChange, disabled }: Props) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canAddMore = photos.length < MAX_PHOTOS

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // тот же файл можно выбрать повторно после ошибки
    if (!file) return

    if (file.size > MAX_FILE_BYTES) {
      setError(`Файл слишком большой (${Math.round(file.size / 1024 / 1024)} МБ). Максимум 20 МБ.`)
      return
    }

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
    setDeletingId(photoId)
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
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-2">
      {/* Правило адаптивности проекта (docs: «Адаптивность», 375px–2560px):
          на мобиле изображения full-width с lightbox по нажатию, на планшете
          и шире — 2 колонки. Фото листа А4 с почерком иначе нечитаемо:
          миниатюра в 128px на телефоне не даёт понять, что снято. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {photos.map((photo, idx) => (
          <div key={photo.id} className="relative">
            <TaskImage
              src={photo.url}
              alt={`Фото решения ${idx + 1}`}
              // Фото листа А4 — вертикальное; без подсказки пропорций
              // TaskImage взял бы 4:3 и обрезал бы лист по высоте
              width={3}
              height={4}
            />
            {!disabled && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  {/* Всегда видима (не hover-only): на тач-устройстве
                      hover-аффордансы недостижимы. Размер — 44px на телефоне
                      по минимуму тач-таргета, компактнее с планшета. */}
                  <button
                    type="button"
                    className="absolute right-1.5 top-1.5 z-10 flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-background/90 shadow-sm hover:bg-destructive hover:text-destructive-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-label={`Удалить фото решения ${idx + 1}`}
                    title="Удалить фото"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogMedia className="bg-destructive/10 text-destructive">
                      <AlertTriangle />
                    </AlertDialogMedia>
                    <AlertDialogTitle>Удалить фото решения {idx + 1}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Фото будет удалено безвозвратно. Можно будет снять и прикрепить новое,
                      пока работа не сдана.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                    {/* seconds={0} — в отличие от удаления группы/теста, это
                        обратимо (можно переснять), а лишние 3 секунды посреди
                        контрольной ученику дороже, чем защита от опечатки */}
                    <ConfirmDeleteAction
                      onConfirm={() => handleDelete(photo.id)}
                      loading={deletingId === photo.id}
                      label="Удалить фото"
                      seconds={0}
                    />
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        ))}
      </div>

      {!disabled && canAddMore && (
        <Button
          type="button"
          variant="outline"
          // На телефоне кнопка на всю ширину — попасть проще, и она не
          // теряется рядом с фото; с планшета ужимается по содержимому
          className="w-full sm:w-auto min-h-11 sm:min-h-9"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading
            ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            : <Camera className="mr-1.5 h-4 w-4" />}
          {uploading
            ? 'Загрузка...'
            : photos.length === 0 ? 'Прикрепить фото решения' : 'Добавить ещё фото'}
        </Button>
      )}

      {!disabled && (
        <>
          <p className="text-xs text-muted-foreground">
            Сфотографируйте письменное решение (до {MAX_PHOTOS} фото) — учитель увидит его при проверке.
          </p>
          {/* Без capture: на телефоне откроется выбор «камера или галерея».
              С capture="environment" камера открывалась бы сразу, и уже
              снятое до начала теста фото прикрепить было бы нельзя. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileSelected}
          />
        </>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">{error}</p>
      )}
    </div>
  )
}
