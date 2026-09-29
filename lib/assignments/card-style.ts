// Визуальное состояние карточки задания по статусу попытки — общее для
// AssignmentCard (StudentHome, плоский список) и RoadmapTimeline (таймлайн
// программы). Раньше цветовое различие карточек было только в
// RoadmapTimeline (rowStatusClass, существовала только там) — в плоском
// списке все карточки были одного нейтрального цвета независимо от статуса.
// Модуль чистый (никаких supabase-клиентов), как и lib/assignments/completion.ts.

export type CardKind = 'todo' | 'active' | 'review' | 'done_ok' | 'done_low' | 'closed'

interface CardStatusInput {
  status: string
  score: number | null
  maxScore: number | null
  isClosed: boolean
}

export function cardKind({ status, score, maxScore, isClosed }: CardStatusInput): CardKind {
  if (status === 'checked') {
    const pct = maxScore && maxScore > 0 ? Math.round(((score ?? 0) / maxScore) * 100) : null
    if (isClosed) return 'closed'
    return pct != null && pct >= 60 ? 'done_ok' : 'done_low'
  }
  if (status === 'submitted') return 'review'
  if (status === 'in_progress') return 'active'
  return 'todo'
}

// Классы фона/рамки на карточку целиком — по образцу rowStatusClass, теперь
// делит одну точку правды на оба места, где рисуется задание.
export const CARD_KIND_CLASS: Record<CardKind, string> = {
  todo: '',
  active: 'bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-900',
  review: 'bg-muted/40',
  done_ok: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900',
  done_low: 'bg-destructive/5 border-destructive/20',
  closed: 'bg-emerald-50/60 border-emerald-200 dark:bg-emerald-950/10 dark:border-emerald-900/60',
}
