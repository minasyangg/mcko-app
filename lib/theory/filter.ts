import type { TheoryBlock } from './types'

export interface TheoryFilterState {
  q: string
  subject: string
  grade: string
  /** Выбранные теги — блок должен содержать ВСЕ (сужение подборки) */
  tags: string[]
}

export const EMPTY_THEORY_FILTER: TheoryFilterState = { q: '', subject: '', grade: '', tags: [] }

// Фильтрация каталога теории на клиенте: блоков на школу немного, список уже
// загружен целиком (lib/theory/load.ts), лишние запросы к БД не нужны.
export function filterTheory<T extends TheoryBlock>(items: T[], f: TheoryFilterState): T[] {
  const q = f.q.trim().toLowerCase()
  return items.filter((b) => {
    if (f.subject && b.subject !== f.subject) return false
    if (f.grade && b.grade !== f.grade) return false
    if (f.tags.length && !f.tags.every((t) => b.tags.includes(t))) return false
    if (q) {
      const hay = `${b.title} ${b.summary ?? ''} ${b.tags.join(' ')} ${b.content_md}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

const gradeKey = (g: string) => (Number.isFinite(Number(g)) ? Number(g) : 1000)

// Значения для выпадающих списков и облака тегов — из самого каталога
export function theoryFacets(items: TheoryBlock[]) {
  const subjects = [...new Set(items.map((b) => b.subject).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, 'ru'))
  const grades = [...new Set(items.map((b) => b.grade).filter((g): g is string => !!g))]
    .sort((a, b) => gradeKey(a) - gradeKey(b) || a.localeCompare(b, 'ru'))
  const tagCount = new Map<string, number>()
  for (const b of items) for (const t of b.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1)
  const tags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
    .map(([tag, count]) => ({ tag, count }))
  return { subjects, grades, tags }
}
