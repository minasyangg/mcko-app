import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { closedReasonLabel } from '@/lib/assignments/completion'
import { cardKind, CARD_KIND_CLASS } from '@/lib/assignments/card-style'
import { ShareAssignmentDialog } from '@/components/student/ShareAssignmentDialog'
import { DeadlineNote } from '@/components/student/DeadlineNote'

export interface TimelineItem {
  assignment_id: string
  test_title: string
  kind: 'homework' | 'test'
  status: string
  score: number | null
  max_score: number | null
  attempts_used: number
  max_attempts: number
  created_at: string | null
  ends_at: string | null
  /** null — назначение открыто; см. lib/assignments/completion */
  closed_reason?: string | null
  /** Последняя попытка сдана после ends_at. null — срока не было. */
  submitted_late?: boolean | null
}
export interface TimelineTopic {
  id: string
  title: string
  state: 'done' | 'active' | 'pending'
  items: TimelineItem[]
  /** Глубина вложенности в дереве программы, 0 — тема верхнего уровня. */
  depth: number
}

function ItemStatus({ it }: { it: TimelineItem }) {
  if (it.status === 'checked') {
    const pct = it.max_score && it.max_score > 0 ? Math.round(((it.score ?? 0) / it.max_score) * 100) : null
    return <Badge variant={pct != null && pct >= 60 ? 'default' : 'destructive'}>Проверено {it.score ?? 0}/{it.max_score ?? 0}</Badge>
  }
  if (it.status === 'submitted') return <Badge variant="secondary">На проверке</Badge>
  if (it.status === 'in_progress') return <Badge variant="outline" className="border-orange-400 text-orange-600">В процессе</Badge>
  return <Badge variant="outline">Не начато</Badge>
}

function LateNote({ it }: { it: TimelineItem }) {
  if (!it.submitted_late) return null
  if (it.status !== 'submitted' && it.status !== 'checked') return null
  return <span className="text-[11px] text-muted-foreground">сдано с опозданием</span>
}

// Фон карточки задания по статусу — общий модуль lib/assignments/card-style,
// тот же, что использует AssignmentCard в StudentHome (раньше здесь была
// отдельная копия rowStatusClass, не учитывавшая closed_reason — закрытое
// программное задание визуально не отличалось от обычного «Проверено»).
function rowStatusClass(it: TimelineItem): string {
  return CARD_KIND_CLASS[cardKind({
    status: it.status, score: it.score, maxScore: it.max_score, isClosed: it.closed_reason != null,
  })]
}

function ItemAction({ it }: { it: TimelineItem }) {
  const isDone = it.status === 'submitted' || it.status === 'checked'
  const attemptsLeft = it.max_attempts - it.attempts_used
  const canStart = !it.closed_reason && attemptsLeft > 0 && !['in_progress', 'submitted'].includes(it.status)
  const nextAttemptLabel = `${it.attempts_used + 1}-я попытка`
  // h-8/h-9 (32/36px), не h-7 (28px): рекомендованный минимум тач-цели —
  // 44px, к нему не дотягиваем и на увеличенном размере, но это уже
  // значимо ближе, чем было, при разумном визуальном весе внутри плотного
  // ряда — полные 44px здесь раздули бы строку сильнее, чем оправдано
  // числом элементов в ней (бейдж+название+статус+действие).
  return (
    <div className="flex items-center gap-1.5">
      {isDone && (
        <Button asChild size="sm" variant="outline" className="h-8 sm:h-7 text-xs">
          <Link href={`/student/attempt/${it.assignment_id}/result`}>Результат</Link>
        </Button>
      )}
      {isDone && <ShareAssignmentDialog assignmentId={it.assignment_id} testTitle={it.test_title} compact />}
      {it.status === 'in_progress' ? (
        <Button asChild size="sm" className="h-8 sm:h-7 text-xs"><Link href={`/student/attempt/${it.assignment_id}`}>Продолжить</Link></Button>
      ) : !isDone && canStart ? (
        <Button asChild size="sm" className="h-8 sm:h-7 text-xs"><Link href={`/student/attempt/${it.assignment_id}`}>Начать</Link></Button>
      ) : isDone && canStart ? (
        <Button asChild size="sm" variant="secondary" className="h-8 sm:h-7 text-xs"><Link href={`/student/attempt/${it.assignment_id}`}>{nextAttemptLabel}</Link></Button>
      ) : null}
    </div>
  )
}

// "Попыток использовано: X/Y" — та же информация, что уже показывается в
// "Мои тесты" (app/student/page.tsx), но раньше отсутствовала в "Программе"
// несмотря на то, что assignment.attempts_used/max_attempts там тоже
// вычислялись — использовались только для canStart, не выводились текстом.
function AttemptsInfo({ it }: { it: TimelineItem }) {
  // Завершение по полному баллу / решению учителя показываем и у однопопыточных
  // заданий: там остаток попыток ничего не объясняет, а причина — объясняет
  const note = closedReasonLabel(it.closed_reason)
  if (note && it.closed_reason !== 'attempts_exhausted') {
    return (
      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
        ✓ Завершено — {note}
      </p>
    )
  }
  const isDone = it.status === 'submitted' || it.status === 'checked'
  const attemptsLeft = it.max_attempts - it.attempts_used
  if (note || (isDone && attemptsLeft <= 0)) {
    return (
      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
        ✓ Все попытки использованы ({it.attempts_used}/{it.max_attempts})
      </p>
    )
  }
  return (
    <>
      {it.max_attempts > 1 && (
        <p className="text-xs text-muted-foreground">
          Попыток использовано: {it.attempts_used}/{it.max_attempts}
        </p>
      )}
      {!isDone && <DeadlineNote createdAt={it.created_at} endsAt={it.ends_at} />}
    </>
  )
}

// Отступ на уровень вложенности — ограничен 2 уровнями (0, 1, 2+ считается
// как 2): на мобильной ширине третий уровень съедал бы слишком много и без
// того узкой колонки, дальнейшая вложенность и так видна по размеру узла и
// более тонкой линии, без необходимости сдвигать текст ещё дальше.
const MAX_VISUAL_DEPTH = 2
const INDENT_PER_DEPTH = 24

export function RoadmapTimeline({ topics }: { topics: TimelineTopic[] }) {
  if (topics.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">В программе пока нет тем.</p>
  }
  // Нумеруем только темы верхнего уровня — сквозная нумерация вместе с
  // подтемами выглядела бы так, будто подтема равноправна с главной темой
  // программы (та самая путаница со скриншота: "Область определения..."
  // получала номер 3 наравне с "Функции", хотя на деле — её часть).
  let topLevelCounter = 0
  return (
    <ol className="relative">
      {topics.map((t, i) => {
        const last = i === topics.length - 1
        const nextDepth = topics[i + 1]?.depth ?? 0
        // линия ведёт к следующему узлу, только если он остаётся на том же
        // уровне или уходит глубже (следующий — потомок этого) — когда
        // следующий узел мельче (мы вышли из ветки), линия обрывается здесь,
        // иначе она визуально "протыкала" бы соседнюю тему верхнего уровня
        const connectsToNext = !last && nextDepth >= t.depth
        const depth = Math.min(t.depth, MAX_VISUAL_DEPTH)
        const isSub = t.depth > 0
        if (t.depth === 0) topLevelCounter++

        return (
          <li key={t.id} className="relative pb-6" style={{ paddingLeft: `${10 + depth * INDENT_PER_DEPTH + (isSub ? 30 : 0)}px` }}>
            {/* вертикальная линия */}
            {connectsToNext && (
              <span
                className={cn('absolute top-7 bottom-0 w-px bg-border', isSub && 'opacity-60')}
                style={{ left: `${15 + depth * INDENT_PER_DEPTH}px` }}
              />
            )}
            {/* узел темы: полный кружок с номером/галочкой для темы верхнего
                уровня, компактная засечка на линии для подтемы — чтобы не
                спорить визуально с номерами родителя */}
            {isSub ? (
              <span
                className={cn(
                  'absolute top-2.5 flex h-3 w-3 items-center justify-center rounded-full border-2',
                  t.state === 'done'
                    ? 'bg-emerald-500 border-emerald-500'
                    : t.state === 'active'
                      ? 'border-blue-500 bg-background'
                      : 'border-border bg-background'
                )}
                style={{ left: `${15 + depth * INDENT_PER_DEPTH - 6}px` }}
              />
            ) : (
              <span className={cn(
                'absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold',
                t.state === 'done'
                  ? 'bg-emerald-500 border-emerald-500 text-white'
                  : t.state === 'active'
                    ? 'border-blue-500 text-blue-600 bg-background'
                    : 'border-border text-muted-foreground bg-background'
              )}>
                {t.state === 'done' ? <Check className="h-4 w-4" /> : topLevelCounter}
              </span>
            )}

            <div className="pt-1">
              <h3 className={cn(
                isSub ? 'text-sm font-medium' : 'font-medium',
                t.state === 'done' && 'text-muted-foreground'
              )}>{t.title}</h3>
              <div className="mt-2 space-y-1.5">
                {t.items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Заданий нет</p>
                ) : (
                  t.items.map(it => (
                    // Ниже ~480px строка «бейдж + название + статус + действие»
                    // не помещается в один ряд предсказуемо — flex-wrap
                    // переносил элементы в случайном порядке в зависимости от
                    // длины названия. Явная раскладка: название всегда сверху
                    // отдельной строкой, статус+действие снизу — вместо
                    // надежды на автоматический перенос.
                    <div key={it.assignment_id} className={cn('space-y-1.5 rounded-md border px-3 py-2', rowStatusClass(it))}>
                      <div className="flex items-start gap-2">
                        <Badge variant={it.kind === 'homework' ? 'outline' : 'secondary'} className="text-[11px] shrink-0 mt-0.5">
                          {it.kind === 'homework' ? 'ДЗ' : 'Тест'}
                        </Badge>
                        <span className="text-sm flex-1 min-w-0 wrap-break-word">{it.test_title}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <ItemStatus it={it} />
                        <LateNote it={it} />
                        <span className="ml-auto"><ItemAction it={it} /></span>
                      </div>
                      <AttemptsInfo it={it} />
                    </div>
                  ))
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
