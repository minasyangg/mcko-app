// Состояние «назначение завершено» — общий словарь для сервера и клиента.
// Модуль намеренно чистый (никаких supabase-клиентов): его импортируют и
// серверные страницы, и клиентские таблицы учителя, и попадание сюда
// service-role клиента утащило бы его в браузерный бандл.

/**
 * Почему назначение закрыто для ученика
 * (student_final_results.closed_reason, миграция 038).
 * null — открыто, оставшиеся попытки можно тратить.
 */
export type ClosedReason = 'max_score' | 'attempts_exhausted' | 'forced' | null

export const CLOSED_REASON_LABEL: Record<Exclude<ClosedReason, null>, string> = {
  max_score: 'набран максимальный балл',
  attempts_exhausted: 'попытки исчерпаны',
  forced: 'завершено учителем',
}

export function closedReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null
  return CLOSED_REASON_LABEL[reason as Exclude<ClosedReason, null>] ?? null
}
