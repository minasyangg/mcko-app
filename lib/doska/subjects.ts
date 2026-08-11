/**
 * Предметы, которые можно указать у доски.
 *
 * Предмет в mcko-app везде хранится обычной строкой (tests.subject,
 * roadmaps.subject, library_problems.subject) — справочника в базе нет. Список
 * ниже повторяет тот, что предлагается в библиотеке заданий
 * (components/teacher/LibraryFilter.tsx), чтобы у доски и у заданий предмет
 * назывался одинаково и результаты сходились при поиске.
 *
 * Если в LibraryFilter список пополнится, дополните и здесь: связывать их
 * импортом не стали намеренно — тот файл клиентский и тянет за собой всю
 * обвязку фильтра ради одного массива строк.
 */
export const DOSKA_SUBJECTS = [
  'Математика',
  'Математика (база)',
  'Физика',
  'Химия',
  'Биология',
  'История',
  'Обществознание',
  'Информатика',
  'Русский язык',
  'Литература',
  'География',
  'Английский язык',
] as const

export type DoskaSubject = (typeof DOSKA_SUBJECTS)[number]

/** Предмет из формы: пустое значение допустимо, чужое — нет. */
export function normalizeSubject(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return null
  return (DOSKA_SUBJECTS as readonly string[]).includes(s) ? s : null
}
