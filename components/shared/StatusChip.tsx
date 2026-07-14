import { cn } from '@/lib/utils'

// Чип статуса попытки — переиспользуется в MonitorTable и в мониторинге
// прогресса программ (ProgramProgressView), чтобы визуальный язык не
// расходился.
export const STATUS_LABELS: Record<string, string> = {
  not_started: 'Не начата',
  in_progress: 'В процессе',
  submitted: 'Ожидает проверки',
  under_review: 'Ожидает проверки',
  checked: 'Проверено',
  completed: 'Тест завершён',
  expired: 'Истекла',
}

const STATUS_COLORS: Record<string, string> = {
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  submitted: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  under_review: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  not_started: 'bg-muted text-muted-foreground',
  checked: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  expired: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',
}

export function StatusChip({
  status, attemptNumber, maxAttempts,
}: {
  status: string
  attemptNumber?: number
  maxAttempts?: number
}) {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium'
  const showAttempt = attemptNumber && maxAttempts && maxAttempts > 1
  let label = STATUS_LABELS[status] ?? status
  if (showAttempt && status !== 'completed') {
    label += ` · попытка ${attemptNumber}`
  }
  return (
    <span className={cn(base, STATUS_COLORS[status] ?? 'bg-muted text-muted-foreground')}>
      {status === 'in_progress' && (
        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse inline-block" />
      )}
      {label}
    </span>
  )
}
