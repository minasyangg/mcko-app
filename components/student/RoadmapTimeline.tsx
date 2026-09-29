'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { closedReasonLabel } from '@/lib/assignments/completion'
import { cardKind, CARD_KIND_CLASS, isUnfinishedKind } from '@/lib/assignments/card-style'
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

// Задание «незакончено» — тот же критерий, что делит карточки на секции
// «Нужно сделать»/«На проверке»/«Проверено» в StudentHome (sectionOf):
// не начато, в процессе или на проверке учителя, и назначение не закрыто
// досрочно. Используется, чтобы решить, какие шаги раскрывать при первой
// загрузке — шаг с хотя бы одним таким заданием разворачивается сразу,
// полностью пройденный сворачивается.
function itemUnfinished(it: TimelineItem): boolean {
  return isUnfinishedKind(cardKind({
    status: it.status, score: it.score, maxScore: it.max_score, isClosed: it.closed_reason != null,
  }))
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

// Три уровня, три явно разных визуальных веса — раньше раздел и подтема
// были почти одинаковыми по размеру шрифта, а нумерованный узел стоял у
// раздела (контейнера-рубрики вроде "Функции"), хотя реальный прогресс
// ученик проходит по подтемам/заданиям внутри него — нумерация у раздела
// ничего не объясняла, а у подтемы её как раз не хватало.
//
//  1. РАЗДЕЛ ("Функции", "Геометрия") — крупный заголовок-разделитель без
//     узла таймлайна вообще: это рубрика, не шаг прогресса, нумеровать её
//     как шаг — вводит в заблуждение.
//  2. ШАГ ("Область определения...", "Нули функции...", либо задание
//     раздела без своей подтемы) — вот что реально нумеруется: полноценный
//     узел с кружком-номером, самый заметный элемент таймлайна после
//     заголовка раздела.
//  3. ЗАДАНИЕ (карточка теста/ДЗ внутри шага) — заметно мельче названия
//     шага и всегда визуально "внутри" него (общий отступ и общий фон блока
//     шага), а не отдельная строка того же веса.
export function RoadmapTimeline({ topics }: { topics: TimelineTopic[] }) {
  if (topics.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">В программе пока нет тем.</p>
  }

  // Сначала — честное дерево: раздел (depth=0) + его прямые подтемы
  // (depth>0, в текущих данных ровно один уровень). Дальше на его основе
  // решаем, что в этом разделе считать "шагом":
  //  - есть подтемы → шаги это подтемы; задания, назначенные прямо на
  //    раздел (не на конкретную подтему), идут первым безымянным шагом
  //    "Общие задания" — такие в данных теоретически возможны
  //    (school-topic назначение без привязки к подтеме) и не должны молча
  //    потеряться;
  //  - подтем нет → раздел сам единственный шаг (случай "Входного пробника"
  //    на скриншоте: задания есть, подтемы нет).
  interface Step { id: string; title: string; state: TimelineTopic['state']; items: TimelineItem[] }
  const tree: { section: TimelineTopic; subs: TimelineTopic[] }[] = []
  for (const t of topics) {
    if (t.depth === 0) tree.push({ section: t, subs: [] })
    else tree[tree.length - 1]?.subs.push(t)
  }
  const groups: { sectionTitle: string; steps: Step[] }[] = tree.map(({ section, subs }) => {
    if (subs.length === 0) {
      return { sectionTitle: section.title, steps: [{ id: section.id, title: section.title, state: section.state, items: section.items }] }
    }
    const steps: Step[] = subs.map(s => ({ id: s.id, title: s.title, state: s.state, items: s.items }))
    if (section.items.length > 0) {
      steps.unshift({ id: section.id, title: 'Общие задания', state: section.state, items: section.items })
    }
    return { sectionTitle: section.title, steps }
  })

  // Сквозная нумерация шагов по ВСЕЙ программе (не с обнулением на каждом
  // разделе) — так ученик видит "шаг 4 из 12", а не три независимых "шаг 1".
  let stepCounter = 0
  const allSteps = groups.flatMap(g => g.steps)

  return (
    <div className="space-y-6">
      {groups.map(g => (
        <section key={g.sectionTitle}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80 mb-3">
            {g.sectionTitle}
          </h2>
          <ol className="space-y-0">
            {g.steps.map((step, i) => {
              stepCounter++
              const last = i === g.steps.length - 1
              return (
                <TimelineStep
                  key={step.id}
                  step={step}
                  number={stepCounter}
                  connectsToNext={!last}
                  defaultExpanded={step.items.some(itemUnfinished)}
                />
              )
            })}
          </ol>
        </section>
      ))}
      {allSteps.length > 0 && allSteps.every(s => s.items.length === 0) && (
        <p className="text-sm text-muted-foreground">В программе пока нет заданий.</p>
      )}
    </div>
  )
}

function TimelineStep({
  step, number, connectsToNext, defaultExpanded,
}: {
  step: { id: string; title: string; state: TimelineTopic['state']; items: TimelineItem[] }
  number: number
  connectsToNext: boolean
  defaultExpanded: boolean
}) {
  // Раскрыт по умолчанию, если в шаге есть хоть одно незаконченное задание —
  // так ученик сразу видит, что ему осталось сделать, а полностью пройденные
  // темы не занимают экран. Состояние — по шагу (id), не по всему таймлайну:
  // "скрыть вложенные элементы" относится к конкретной теме, не переключает
  // всё разом.
  const [expanded, setExpanded] = useState(defaultExpanded)
  const hasItems = step.items.length > 0

  return (
    <li className="grid grid-cols-[2rem_1fr] gap-x-3">
      {/* Рельс: узел шага + линия к следующему — своя колонка грида,
          физически не может пересечься с текстом справа независимо от его
          длины. */}
      <div className="flex flex-col items-center">
        <span className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold',
          step.state === 'done'
            ? 'bg-emerald-500 border-emerald-500 text-white'
            : step.state === 'active'
              ? 'border-blue-500 text-blue-600 bg-background'
              : 'border-border text-muted-foreground bg-background'
        )}>
          {step.state === 'done' ? <Check className="h-4 w-4" /> : number}
        </span>
        {connectsToNext && <span className="w-px flex-1 bg-border mt-1" />}
      </div>

      <div className={cn('min-w-0', connectsToNext && 'pb-4')}>
        <button
          type="button"
          onClick={() => hasItems && setExpanded(v => !v)}
          disabled={!hasItems}
          className={cn(
            'flex w-full items-center gap-1.5 text-left pt-1 -ml-1 pl-1 rounded',
            hasItems && 'hover:bg-muted/50 transition-colors cursor-pointer'
          )}
        >
          <h3 className={cn('font-medium flex-1 min-w-0', step.state === 'done' && 'text-muted-foreground')}>
            {step.title}
          </h3>
          {hasItems && (
            <>
              <span className="text-xs text-muted-foreground shrink-0">{step.items.length}</span>
              <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
            </>
          )}
        </button>
        {hasItems && expanded && (
          <div className="mt-2 space-y-1.5">
            <TopicItems items={step.items} />
          </div>
        )}
        {!hasItems && (
          <p className="mt-2 text-xs text-muted-foreground">Заданий нет</p>
        )}
      </div>
    </li>
  )
}

// Вызывается только когда items непусто (TimelineStep решает это до вызова
// — пустой список ведёт к отдельной ветке "Заданий нет" без кнопки сворачивания).
function TopicItems({ items }: { items: TimelineItem[] }) {
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
