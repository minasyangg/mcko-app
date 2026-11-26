// Очные работы (миграция 116): тест проведён на бумаге, результаты вносит
// учитель. Модуль чистый (без supabase-клиентов) — общий для API, страниц
// учителя и кабинета ученика.

export type AssignmentMode = 'online' | 'offline'

/** Бланк ответов по PDF: сколько фото решения можно приложить ко всей работе */
export const SHEET_MAX_PHOTOS = 3

/** Дата проведения в формате <input type="date"> / колонки date */
export const CONDUCTED_ON_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidConductedOn(v: unknown): v is string {
  return typeof v === 'string' && CONDUCTED_ON_RE.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())
}

/**
 * Момент времени очной попытки (started/submitted/checked_at) — полдень по
 * Москве в день проведения. Точное время урока неизвестно, а полдень не
 * переносит дату ни в одном часовом поясе России при показе.
 */
export function offlineAttemptMoment(conductedOn: string): string {
  return `${conductedOn}T09:00:00.000Z`
}

/** «12.11» — дата проведения в подписях */
export function formatConductedOn(conductedOn: string | null | undefined): string {
  if (!conductedOn) return ''
  const [, m, d] = conductedOn.split('-')
  return `${d}.${m}`
}

/** Сведения об очной работе для карточки ученика */
export interface OfflineInfo {
  conducted_on: string | null
  /** Ученик отмечен «н» — ему открыт тест онлайн */
  absent: boolean
}

/**
 * Очная работа, по которой у ученика ещё нет результата и он не отмечен
 * отсутствующим: писал на бумаге, баллы внесёт учитель. Начать онлайн нельзя.
 */
export function offlineAwaitingResult(it: { offline?: OfflineInfo | null; status: string }): boolean {
  return !!it.offline && !it.offline.absent && it.status === 'not_started'
}
