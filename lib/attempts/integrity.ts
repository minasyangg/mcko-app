// Признаки списывания (миграция 118): выводы по счётчикам поведения
// ученика (attempt_task_signals), которые копит плеер теста. Модуль чистый —
// считает окно проверки учителя (AttemptDrawer) при открытии попытки, поэтому
// пороги ниже меняются без миграций и пересчитываются для старых попыток.
//
// Отметка — подсказка учителю, а не приговор: баллы она не трогает, ученику
// не показывается.

export interface TaskSignals {
  task_id: string
  active_ms: number
  away_count: number
  away_ms: number
  paste_count: number
  pasted_chars: number
  typed_inputs: number
  away_paste_count: number
  blind_paste_count: number
}

export type IntegrityLevel = 'likely' | 'suspect'

export interface IntegrityFlag {
  level: IntegrityLevel
  reasons: string[]
}

/** «Слишком быстро»: не меньше этой медианы класса… */
const FAST_MIN_MEDIAN_MS = 45_000
/** …и активное время меньше этой доли медианы (но не меньше FAST_FLOOR_MS) */
const FAST_SHARE = 0.2
const FAST_FLOOR_MS = 8_000
/** Медиана класса считается, когда есть хотя бы столько попыток */
const MEDIAN_MIN_SAMPLES = 3
/** Уходы со вкладки на одном задании, с которых это подозрительно */
const MANY_AWAYS = 3
/** Вставленный целиком развёрнутый ответ — подозрителен, даже если ещё не проверен */
const LONG_PASTE_CHARS = 40

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} с`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m} мин ${s % 60} с` : `${m} мин`
  return `${Math.floor(m / 60)} ч ${m % 60} мин`
}

export function median(values: number[]): number | null {
  if (values.length < MEDIAN_MIN_SAMPLES) return null
  const v = [...values].sort((a, b) => a - b)
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/**
 * Признаки по одному заданию. correct — ответ засчитан полностью (null —
 * ещё не проверен); classMedianMs — медиана активного времени класса на этом
 * задании (null — мало данных).
 */
export function assessTask(
  s: TaskSignals | undefined,
  { correct, classMedianMs }: { correct: boolean | null; classMedianMs: number | null },
): IntegrityFlag | null {
  if (!s) return null
  const likely: string[] = []
  const suspect: string[] = []

  if (s.away_paste_count > 0 && correct === true) {
    likely.push('ушёл со вкладки и сразу после возвращения вставил верный ответ')
  }
  if (s.blind_paste_count > 0 && correct === true && likely.length === 0) {
    likely.push('верный ответ вставлен из буфера, без набора')
  }
  if (s.blind_paste_count > 0 && s.pasted_chars >= LONG_PASTE_CHARS && correct !== false && likely.length === 0) {
    likely.push(`развёрнутый ответ вставлен целиком (${s.pasted_chars} симв.)`)
  }
  if (s.paste_count > 0 && likely.length === 0) {
    suspect.push(`вставка из буфера ×${s.paste_count}`)
  }
  if (
    correct === true && classMedianMs !== null && classMedianMs >= FAST_MIN_MEDIAN_MS &&
    s.active_ms < Math.max(FAST_FLOOR_MS, classMedianMs * FAST_SHARE)
  ) {
    suspect.push(`верно за ${formatDuration(s.active_ms)} при медиане класса ${formatDuration(classMedianMs)}`)
  }
  if (s.away_count >= MANY_AWAYS) {
    suspect.push(`уходил со вкладки ${s.away_count} раз (${formatDuration(s.away_ms)})`)
  }

  // несколько слабых признаков на верном ответе — уже не случайность
  if (likely.length === 0 && suspect.length >= 2 && correct === true) {
    return { level: 'likely', reasons: suspect }
  }
  if (likely.length > 0) return { level: 'likely', reasons: [...likely, ...suspect] }
  if (suspect.length > 0) return { level: 'suspect', reasons: suspect }
  return null
}

export interface AttemptIntegritySummary {
  activeMs: number
  classMedianMs: number | null
  pasteCount: number
  awayCount: number
  awayMs: number
}

/** Итог по попытке: суммарное активное время против медианы класса и общие счётчики */
export function summarizeAttempt(
  signals: TaskSignals[],
  classTotalsMs: number[],
): AttemptIntegritySummary | null {
  if (signals.length === 0) return null
  return {
    activeMs: signals.reduce((sum, s) => sum + s.active_ms, 0),
    classMedianMs: median(classTotalsMs),
    pasteCount: signals.reduce((sum, s) => sum + s.paste_count, 0),
    awayCount: signals.reduce((sum, s) => sum + s.away_count, 0),
    awayMs: signals.reduce((sum, s) => sum + s.away_ms, 0),
  }
}
