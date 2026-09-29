import { deadlineState } from '@/lib/assignments/deadline'
import { cn } from '@/lib/utils'

// Строка срока сдачи — общая для AssignmentCard (StudentHome) и
// RoadmapTimeline: раньше в обоих местах была одна и та же серая строка
// «До: дата» без реакции на просрочку — теперь единая точка, вместо
// дублирования сравнения дат и цветов в двух компонентах.
export function DeadlineNote({ createdAt, endsAt, className }: {
  createdAt: string | null
  endsAt: string | null
  className?: string
}) {
  if (!endsAt) return null
  const state = deadlineState(endsAt)
  const endsLabel = new Date(endsAt).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })
  const createdLabel = createdAt
    ? new Date(createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })
    : null

  if (state.kind === 'overdue') {
    return (
      <p className={cn('text-xs font-medium text-destructive', className)}>
        Истёк срок сдачи {endsLabel}
      </p>
    )
  }

  return (
    <p className={cn(
      'text-xs',
      state.kind === 'soon' ? 'font-medium text-orange-600 dark:text-orange-400' : 'text-muted-foreground',
      className,
    )}>
      {createdLabel ? `Назначено ${createdLabel} · ` : ''}Срок до {endsLabel}
    </p>
  )
}
