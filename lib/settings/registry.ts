// Настройки системы (миграция 114) — словарь для сервера и клиента.
// Модуль чистый, без supabase-клиентов: его импортируют и роуты, и
// клиентская страница настроек, и браузерные компоненты через контекст.
//
// Значения по умолчанию = поведение до появления настроек. Для ключей,
// которые читает SQL (sql: true), то же число стоит вторым аргументом
// app_setting_int в миграции 114 — менять только вместе.

export type SettingKey =
  | 'late_join_days'
  | 'deadline_soon_days'
  | 'archive_after_days'
  | 'attempts_add_max'
  | 'attempts_total_max'
  | 'solution_access_days'
  | 'share_ttl_default_days'
  | 'repeat_window_months'
  | 'notify_from_hour'
  | 'notify_to_hour'
  | 'notify_interval_min'

export type SettingGroup = 'assignments' | 'student' | 'homework' | 'notifications'

export interface SettingDef {
  key: SettingKey
  group: SettingGroup
  label: string
  description: string
  unit: string
  min: number
  max: number
  default: number
  /** Допустимы только эти значения (выпадающий список вместо поля) */
  options?: number[]
  /** Значение читает и SQL (app_setting_int) */
  sql?: boolean
}

export const SETTING_GROUPS: { key: SettingGroup; title: string }[] = [
  { key: 'assignments', title: 'Назначения и попытки' },
  { key: 'student', title: 'Кабинет ученика' },
  { key: 'homework', title: 'Сборка ДЗ' },
  { key: 'notifications', title: 'Уведомления' },
]

export const SETTING_DEFS: SettingDef[] = [
  {
    key: 'late_join_days', group: 'assignments', sql: true,
    label: 'Поздно вступившие в группу не получают старые задания',
    description: 'Ученик, вступивший в группу позже открытия задания больше чем на это число дней, задание не видит. Открыть ему доступ можно вручную в программе.',
    unit: 'дн.', min: 0, max: 60, default: 3,
  },
  {
    key: 'attempts_add_max', group: 'assignments',
    label: 'Добавить попыток за один раз',
    description: 'Сколько попыток учитель может добавить к назначению одним действием.',
    unit: 'шт.', min: 1, max: 50, default: 10,
  },
  {
    key: 'attempts_total_max', group: 'assignments',
    label: 'Потолок попыток на назначение',
    description: 'Больше этого числа попыток добавить нельзя — защита от опечатки.',
    unit: 'шт.', min: 1, max: 200, default: 50,
  },
  {
    key: 'solution_access_days', group: 'assignments',
    label: 'Доступ к решению после одобрения запроса',
    description: 'Сколько дней ученик видит решение после того, как учитель одобрил запрос.',
    unit: 'дн.', min: 1, max: 90, default: 7,
  },
  {
    key: 'deadline_soon_days', group: 'student',
    label: 'Подсветка «срок скоро»',
    description: 'За сколько дней до срока сдачи строка срока у ученика становится оранжевой.',
    unit: 'дн.', min: 1, max: 30, default: 3,
  },
  {
    key: 'archive_after_days', group: 'student',
    label: 'Архив заданий',
    description: 'Через сколько дней после открытия ученик может убрать задание в архив.',
    unit: 'дн.', min: 30, max: 730, default: 183,
  },
  {
    key: 'share_ttl_default_days', group: 'student',
    label: '«Поделиться работой»: срок по умолчанию',
    description: 'Сколько дней учитель видит работу, которой поделился ученик. Действует для учеников без своего срока в «Пользователях».',
    unit: 'дн.', min: 1, max: 90, default: 14,
  },
  {
    key: 'repeat_window_months', group: 'homework', sql: true,
    label: 'Предупреждение о повторах задач',
    description: 'Задача, которую этот же учитель давал ученику за последние N месяцев, помечается при сборке ДЗ.',
    unit: 'мес.', min: 1, max: 36, default: 11,
  },
  {
    key: 'notify_from_hour', group: 'notifications',
    label: 'Рассылка об открывшихся заданиях: с',
    description: 'Час по Москве, с которого уходят уведомления об отложенно открывшихся заданиях.',
    unit: 'ч МСК', min: 0, max: 23, default: 7,
  },
  {
    key: 'notify_to_hour', group: 'notifications',
    label: 'Рассылка: последний час',
    description: 'Последний час по Москве, в который ещё идёт рассылка (включительно). При 23 и шаге 30 мин последняя отправка — в 23:30.',
    unit: 'ч МСК', min: 0, max: 23, default: 23,
  },
  {
    key: 'notify_interval_min', group: 'notifications',
    label: 'Как часто проверять открывшиеся задания',
    description: 'Шаг рассылки. Уведомление придёт не позже чем через это время после открытия задания.',
    unit: 'мин', min: 15, max: 60, default: 30, options: [15, 30, 60],
  },
]

export type AppSettings = Record<SettingKey, number>

export const DEFAULT_SETTINGS = Object.fromEntries(
  SETTING_DEFS.map(d => [d.key, d.default])
) as AppSettings

const DEF_BY_KEY = new Map(SETTING_DEFS.map(d => [d.key, d]))

export function isSettingKey(key: string): key is SettingKey {
  return DEF_BY_KEY.has(key as SettingKey)
}

/** Ошибка одного значения или null */
export function validateSetting(key: SettingKey, value: unknown): string | null {
  const def = DEF_BY_KEY.get(key)!
  if (typeof value !== 'number' || !Number.isInteger(value)) return `«${def.label}»: нужно целое число`
  if (def.options && !def.options.includes(value)) return `«${def.label}»: допустимо ${def.options.join(', ')}`
  if (value < def.min || value > def.max) return `«${def.label}»: от ${def.min} до ${def.max}`
  return null
}

/** Ошибки сочетания значений или null */
export function validateSettingsCombo(s: AppSettings): string | null {
  if (s.attempts_add_max > s.attempts_total_max) {
    return 'Добавить за раз нельзя больше попыток, чем потолок на назначение'
  }
  if (s.notify_from_hour > s.notify_to_hour) {
    return 'Начало рассылки должно быть не позже последнего часа'
  }
  return null
}

/**
 * Строки app_settings → полный набор значений. Неизвестные ключи
 * игнорируются, кривые значения заменяются значением по умолчанию: настройка
 * никогда не должна ломать работу сайта.
 */
export function normalizeSettings(rows: { key: string; value: unknown }[] | null | undefined): AppSettings {
  const s = { ...DEFAULT_SETTINGS }
  for (const r of rows ?? []) {
    if (isSettingKey(r.key) && validateSetting(r.key, r.value) === null) s[r.key] = r.value as number
  }
  if (s.attempts_add_max > s.attempts_total_max) s.attempts_add_max = s.attempts_total_max
  if (s.notify_from_hour > s.notify_to_hour) {
    s.notify_from_hour = DEFAULT_SETTINGS.notify_from_hour
    s.notify_to_hour = DEFAULT_SETTINGS.notify_to_hour
  }
  return s
}

export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Скрыто ли групповое назначение от ученика правилом «вступил позже»
 * (SQL-двойник — student_sees_group_assignment, 058 → 110 → 114).
 * Нет дат — не скрываем.
 */
export function joinedTooLate(
  joinedAt: string | null | undefined,
  openedAtIso: string | null | undefined,
  lateJoinDays: number
): boolean {
  if (!joinedAt || !openedAtIso) return false
  return new Date(joinedAt).getTime() > new Date(openedAtIso).getTime() + lateJoinDays * DAY_MS
}

type NotifySchedule = Pick<AppSettings, 'notify_from_hour' | 'notify_to_hour' | 'notify_interval_min'>

// Москва — UTC+3 круглый год, pg_cron считает в UTC
const MSK_OFFSET_HOURS = 3

/** Расписание pg_cron для рассылки. Значения по умолчанию дают '*\/30 4-20 * * *' — как в миграции 111. */
export function dispatchCron(s: NotifySchedule): string {
  const minute = s.notify_interval_min >= 60 ? '0' : `*/${s.notify_interval_min}`
  const hours = new Set<number>()
  for (let h = s.notify_from_hour; h <= s.notify_to_hour; h++) hours.add((h - MSK_OFFSET_HOURS + 24) % 24)
  const sorted = [...hours].sort((a, b) => a - b)
  // подряд идущие часы — диапазоном: 4,5,…,20 → 4-20
  const parts: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]))
    i = j + 1
  }
  return `${minute} ${parts.join(',')} * * *`
}

/** «23:30» — время последней отправки по Москве */
export function lastDispatchTime(s: NotifySchedule): string {
  const lastMinute = s.notify_interval_min >= 60 ? 0 : 60 - s.notify_interval_min
  return `${s.notify_to_hour}:${String(lastMinute).padStart(2, '0')}`
}

/** Рассылка идёт круглосуточно — тихих часов нет */
export function dispatchAllDay(s: NotifySchedule): boolean {
  return s.notify_from_hour === 0 && s.notify_to_hour === 23
}
