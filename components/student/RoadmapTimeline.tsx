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

// Раньше узел (кружок/засечка) и линия позиционировались абсолютно поверх
// текста через вручную подобранные пиксельные left-координаты — на подтемах
// с длинным заголовком и на предпросмотре узкой ширины кружок наезжал на
// текст (номер "1" перекрывал первые буквы заголовка "Пробный тест"), а
// засечка подтемы визуально терялась и не читалась как вложенность вообще.
//
// Теперь тема — это grid-строка "рельс | контент": рельс (кружок + линия) и
// текст — РАЗНЫЕ ячейки грида, а не наложенные слои, поэтому пересечься
// физически не могут независимо от длины заголовка. Все подтемы (depth>0,
// в реальных программах их сейчас максимум один уровень) рендерятся ВНУТРИ
// карточки родителя единым плоским списком — глубже второго уровня визуально
// не выделяем: программа с 3+ уровнями вложенности пока не встречалась, а
// вычислять для неё лесенку отступов раньше и обернулось наездом текста.
export function RoadmapTimeline({ topics }: { topics: TimelineTopic[] }) {
  if (topics.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">В программе пока нет тем.</p>
  }

  // Группируем по темам верхнего уровня — подтемы (depth>0) рендерятся
  // ВНУТРИ карточки родителя, а не отдельным элементом списка с ложным
  // отступом. Порядок внутри группы — тот же DFS-порядок, что пришёл из
  // topicsInTreeOrder (server), просто перегруппированный без потери
  // последовательности.
  const groups: { top: TimelineTopic; subs: TimelineTopic[] }[] = []
  for (const t of topics) {
    if (t.depth === 0) groups.push({ top: t, subs: [] })
    else groups[groups.length - 1]?.subs.push(t)
  }

  return (
    <ol className="space-y-3">
      {groups.map((g, i) => {
        const last = i === groups.length - 1
        return (
          <li key={g.top.id} className="grid grid-cols-[2rem_1fr] gap-x-3">
            {/* Рельс: узел темы + линия к следующей теме — своя колонка
                грида фиксированной ширины, никогда не задевает контент. */}
            <div className="flex flex-col items-center">
              <span className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold',
                g.top.state === 'done'
                  ? 'bg-emerald-500 border-emerald-500 text-white'
                  : g.top.state === 'active'
                    ? 'border-blue-500 text-blue-600 bg-background'
                    : 'border-border text-muted-foreground bg-background'
              )}>
                {g.top.state === 'done' ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              {!last && <span className="w-px flex-1 bg-border mt-1" />}
            </div>

            <div className={cn('min-w-0', !last && 'pb-3')}>
              <h3 className={cn('font-medium pt-1', g.top.state === 'done' && 'text-muted-foreground')}>
                {g.top.title}
              </h3>
              <div className="mt-2 space-y-1.5">
                <TopicItems items={g.top.items} />
              </div>

              {/* Подтемы: видимая скобка слева + лёгкая подложка — читается
                  как "часть темы выше" на любой ширине, без вычисления
                  отступа текста по пикселям под конкретную глубину. */}
              {g.subs.length > 0 && (
                <div className="mt-3 space-y-3">
                  {g.subs.map(sub => (
                    <div key={sub.id} className="border-l-2 border-border/70 pl-3 ml-1">
                      <h4 className={cn(
                        'text-sm font-medium flex items-center gap-1.5',
                        sub.state === 'done' && 'text-muted-foreground'
                      )}>
                        <span className={cn(
                          'inline-block h-2 w-2 shrink-0 rounded-full',
                          sub.state === 'done' ? 'bg-emerald-500' : sub.state === 'active' ? 'bg-blue-500' : 'bg-border'
                        )} />
                        {sub.title}
                      </h4>
                      <div className="mt-1.5 space-y-1.5">
                        <TopicItems items={sub.items} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function TopicItems({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">Заданий нет</p>
  }
  return (
    <>
      {items.map(it => (
        // Ниже ~480px строка «бейдж + название + статус + действие» не
        // помещается в один ряд предсказуемо — flex-wrap переносил элементы
        // в случайном порядке в зависимости от длины названия. Явная
        // раскладка: название всегда сверху отдельной строкой, статус+
        // действие снизу — вместо надежды на автоматический перенос.
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
      ))}
    </>
  )
}
