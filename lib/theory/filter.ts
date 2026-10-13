import type { TheoryBlock } from './types'

export interface TheoryFilterState {
  q: string
  subject: string
  grade: string
}

export const EMPTY_THEORY_FILTER: TheoryFilterState = { q: '', subject: '', grade: '' }

// Фильтрация каталога теории на клиенте: блоков на школу немного, список уже
// загружен целиком (lib/theory/load.ts), лишние запросы к БД не нужны.
// Теги отдельным фильтром не выводятся, но по ним ищет строка поиска.
export function filterTheory<T extends TheoryBlock>(items: T[], f: TheoryFilterState): T[] {
  const q = f.q.trim().toLowerCase()
  return items.filter((b) => {
    if (f.subject && b.subject !== f.subject) return false
    if (f.grade && b.grade !== f.grade) return false
    if (q) {
      const hay = `${b.title} ${b.summary ?? ''} ${b.tags.join(' ')} ${b.content_md}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

const gradeKey = (g: string) => (Number.isFinite(Number(g)) ? Number(g) : 1000)

// Значения для быстрых фильтров по предмету и списка классов — из самого каталога.
// Счётчик у предмета учитывает остальные фильтры (класс, поиск), но не сам
// предмет: видно, сколько блоков станет, если переключиться на него.
export function theoryFacets(items: TheoryBlock[], f: TheoryFilterState = EMPTY_THEORY_FILTER) {
  const grades = [...new Set(items.map((b) => b.grade).filter((g): g is string => !!g))]
    .sort((a, b) => gradeKey(a) - gradeKey(b) || a.localeCompare(b, 'ru'))
  const pool = filterTheory(items, { ...f, subject: '' })
  const count = new Map<string, number>()
  for (const b of items) if (b.subject && !count.has(b.subject)) count.set(b.subject, 0)
  for (const b of pool) if (b.subject) count.set(b.subject, (count.get(b.subject) ?? 0) + 1)
  const subjects = [...count.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'ru'))
    .map(([subject, n]) => ({ subject, count: n }))
  return { subjects, grades, total: pool.length }
}
