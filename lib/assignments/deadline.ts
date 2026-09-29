// Состояние срока сдачи назначения — общий словарь для сервера и клиента, по
// образцу lib/assignments/completion.ts. Модуль намеренно чистый (никаких
// supabase-клиентов): импортируется и серверными страницами кабинета
// ученика, и клиентскими карточками — попадание сюда service-role клиента
// утащило бы его в браузерный бандл.

export type DeadlineKind = 'none' | 'ok' | 'soon' | 'overdue'

export interface DeadlineState {
  kind: DeadlineKind
  /** Дней до срока (для 'soon'/'ok') или дней с момента просрочки (для 'overdue', положительное число). null для 'none'. */
  days: number | null
}

// Порог «скоро» — 3 дня, то же число, что уже использует правило «вступил в
// группу не позже чем через 3 дня после назначения» (миграция 058,
// notJoinedLate в app/student/page.tsx) — согласованность формулировки в
// интерфейсе, не переиспользование той же логики (смысл разный: там — окно
// видимости назначения, здесь — подсветка приближающегося срока).
const SOON_THRESHOLD_DAYS = 3
const MS_PER_DAY = 24 * 60 * 60 * 1000

export function deadlineState(endsAt: string | null, now: Date = new Date()): DeadlineState {
  if (!endsAt) return { kind: 'none', days: null }
  const diffMs = new Date(endsAt).getTime() - now.getTime()
  const days = Math.ceil(Math.abs(diffMs) / MS_PER_DAY)
  if (diffMs < 0) return { kind: 'overdue', days }
  if (diffMs <= SOON_THRESHOLD_DAYS * MS_PER_DAY) return { kind: 'soon', days }
  return { kind: 'ok', days }
}
