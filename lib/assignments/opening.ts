// Дата открытия назначения (assignments.starts_at, миграция 110) — общий
// словарь для сервера и клиента. Модуль намеренно чистый, как deadline.ts:
// его импортируют и роуты, и клиентские формы учителя.
//
// До даты открытия ученик назначение не видит и начать не может (RLS), а
// уведомление уходит в момент открытия (/api/notifications/dispatch).

/** Подсказка под полем «Открыть» в формах назначения. Расписание рассылки — миграция 110. */
export function openingHint(deferred: boolean): string {
  return deferred
    ? 'Ученики увидят задание в момент открытия. Уведомление придёт в течение 3 часов; с 2:00 до 7:00 уведомления не отправляются.'
    : 'Откроется сразу. Поставьте дату позже — до неё ученики задание не увидят.'
}

/** Момент, с которого назначение доступно ученику: дата открытия, но не раньше создания. */
export function openedAt(a: { starts_at?: string | null; created_at?: string | null }): string | null {
  const created = a.created_at ? new Date(a.created_at).getTime() : null
  const starts = a.starts_at ? new Date(a.starts_at).getTime() : null
  if (created == null && starts == null) return null
  return new Date(Math.max(created ?? -Infinity, starts ?? -Infinity)).toISOString()
}

/** Назначение откроется позже: дата открытия ещё не наступила. */
export function opensLater(startsAt: string | null | undefined, now: Date = new Date()): boolean {
  return !!startsAt && new Date(startsAt).getTime() > now.getTime()
}

/**
 * Даты из формы назначения: строки ISO (форма переводит локальное время
 * учителя в UTC сама). Пустое → null. Возвращает ошибку для неразборчивой
 * даты и для срока сдачи, который не позже открытия.
 */
export function parseAssignmentDates(input: { starts_at?: string | null; ends_at?: string | null }):
  | { ok: true; startsAt: string | null; endsAt: string | null }
  | { ok: false; error: string } {
  const parse = (v: string | null | undefined) => {
    if (!v) return null
    const t = new Date(v).getTime()
    return Number.isNaN(t) ? undefined : new Date(t).toISOString()
  }
  const startsAt = parse(input.starts_at)
  const endsAt = parse(input.ends_at)
  if (startsAt === undefined) return { ok: false, error: 'Некорректная дата открытия' }
  if (endsAt === undefined) return { ok: false, error: 'Некорректный срок сдачи' }
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    return { ok: false, error: 'Срок сдачи должен быть позже даты открытия' }
  }
  return { ok: true, startsAt, endsAt }
}

/**
 * Значение для <input type="datetime-local"> из момента времени — в часовом
 * поясе браузера учителя, без секунд. Вызывать только в браузере: на сервере
 * часовой пояс другой (UTC на Vercel).
 */
export function toLocalInputValue(date: Date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

/** Значение <input type="datetime-local"> (локальное время браузера) → ISO в UTC. */
export function localInputToIso(value: string | null | undefined): string | null {
  if (!value) return null
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}
