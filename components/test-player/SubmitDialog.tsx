'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Loader2 } from 'lucide-react'

interface SubmitDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  answeredCount: number
  totalCount: number
  /** Задания с ручной проверкой, к которым не приложено фото решения */
  missingPhotoTaskNumbers?: number[]
  isSubmitting: boolean
}

export function SubmitDialog({
  open,
  onClose,
  onConfirm,
  answeredCount,
  totalCount,
  missingPhotoTaskNumbers = [],
  isSubmitting,
}: SubmitDialogProps) {
  const unanswered = totalCount - answeredCount
  const hasUnanswered = unanswered > 0

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Завершить тест?</AlertDialogTitle>
          <AlertDialogDescription>
            {hasUnanswered ? (
              <>
                Вы ответили на <strong>{answeredCount}</strong> из{' '}
                <strong>{totalCount}</strong> задач.{' '}
                <span className="text-destructive font-medium">
                  {unanswered} {unanswered === 1 ? 'задача' : unanswered < 5 ? 'задачи' : 'задач'} без ответа.
                </span>{' '}
                После завершения изменить ответы будет невозможно.
              </>
            ) : (
              <>
                Вы ответили на все <strong>{totalCount}</strong> задачи. После
                завершения изменить ответы будет невозможно.
              </>
            )}
            {/* span, а не p: Description сам рендерится как <p> */}
            {missingPhotoTaskNumbers.length > 0 && (
              <span className="mt-2 block text-amber-700 dark:text-amber-400">
                Нет фото решения в {missingPhotoTaskNumbers.length === 1 ? 'задании' : 'заданиях'}{' '}
                {'№ '}{missingPhotoTaskNumbers.join(', ')} — их проверяет учитель, без фото балл
                может быть снижен.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose} disabled={isSubmitting}>
            Отмена
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
            disabled={isSubmitting}
            className={hasUnanswered ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Отправка...
              </>
            ) : (
              'Завершить тест'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
