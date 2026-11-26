import { formatConductedOn, type OfflineInfo } from '@/lib/assignments/offline'

// Подпись очной работы (116) — общая для карточки в списке и ленты программы:
// когда писали и, если ученик отсутствовал, что работу можно написать на сайте
// (или просто что он отсутствовал — у работы «только баллы» сайт-версии нет).
export function OfflineNote({ offline, isDone }: { offline: OfflineInfo; isDone: boolean }) {
  const date = formatConductedOn(offline.conducted_on)
  return (
    <>
      <p className="text-xs text-muted-foreground">Очная работа{date ? ` · ${date}` : ''}</p>
      {offline.absent && !isDone && (
        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
          {offline.makeup ? 'Вы отсутствовали — напишите тест на сайте' : 'Вы отсутствовали на работе'}
        </p>
      )}
    </>
  )
}
