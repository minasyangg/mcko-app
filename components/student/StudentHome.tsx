'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ClipboardList, Route } from 'lucide-react'
import { closedReasonLabel } from '@/lib/assignments/completion'
import { RoadmapTimeline, type TimelineTopic } from '@/components/student/RoadmapTimeline'

export type AssignmentStatus = 'not_started' | 'in_progress' | 'submitted' | 'checked'

export interface AssignmentCardData {
  assignment_id: string
  test_title: string
  subject: string | null
  exam_type: string | null
  kind: 'test' | 'homework'
  /** «Программа «X» → тема Y» / «Группа «Y»» — null для персональных назначений */
  source: string | null
  time_limit_sec: number | null
  status: AssignmentStatus
  score: number | null
  max_score: number | null
  attempts_used: number
  max_attempts: number
  ends_at: string | null
  closed_reason: string | null
}

export interface RoadmapGroup {
  id: string
  title: string
  subject: string | null
  topics: TimelineTopic[]
}

function StatusBadge({ status, score, maxScore }: { status: AssignmentStatus; score?: number | null; maxScore?: number | null }) {
  if (status === 'checked') {
    const pct = maxScore && maxScore > 0 ? Math.round(((score ?? 0) / maxScore) * 100) : null
    return (
      <Badge variant={pct != null && pct >= 60 ? 'default' : 'destructive'}>
        Проверено {score ?? 0}/{maxScore ?? 0}
      </Badge>
    )
  }
  if (status === 'submitted') return <Badge variant="secondary">На проверке</Badge>
  if (status === 'in_progress') return <Badge variant="outline" className="border-orange-400 text-orange-600">В процессе</Badge>
  return <Badge variant="outline">Не начато</Badge>
}

// Единая карточка назначения — общая для обычных тестов/ДЗ и заданий
// программы: раньше это были два разных экрана с двумя разными вёрстками,
// и задание из программы нельзя было увидеть, не зайдя специально в
// «Программа». Строка source (если есть) — единственное отличие: ученик
// должен понимать, что именно перед ним, когда в списке несколько похожих
// по названию заданий из разных источников.
function AssignmentCard({ a }: { a: AssignmentCardData }) {
  const isDone = a.status === 'submitted' || a.status === 'checked'
  const attemptsLeft = a.max_attempts - a.attempts_used
  const isClosed = a.closed_reason != null
  const canStart = !isClosed && attemptsLeft > 0 && !['in_progress', 'submitted'].includes(a.status)

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight">{a.test_title}</CardTitle>
          <Badge variant={a.kind === 'homework' ? 'outline' : 'secondary'} className="shrink-0 text-[11px]">
            {a.kind === 'homework' ? 'ДЗ' : 'Тест'}
          </Badge>
        </div>
        {a.subject && <CardDescription>{a.subject}</CardDescription>}
        {a.source && (
          <p className="text-xs text-muted-foreground/80 flex items-center gap-1">
            <Route className="h-3 w-3 shrink-0" />
            {a.source}
          </p>
        )}
      </CardHeader>
      <CardContent className="flex-1 text-sm text-muted-foreground space-y-2">
        {/* накопительный итог, а не балл последней попытки — то же число,
            что на странице результата */}
        <StatusBadge status={a.status} score={a.score} maxScore={a.max_score} />

        <div className="space-y-1 text-xs">
          {a.time_limit_sec && <p>Время: {Math.round(a.time_limit_sec / 60)} мин</p>}
          {a.ends_at && <p>До: {new Date(a.ends_at).toLocaleDateString('ru-RU')}</p>}
          {isClosed
            ? ((a.max_attempts ?? 1) > 1 || a.closed_reason !== 'attempts_exhausted') && (
                <p className="font-medium text-emerald-700 dark:text-emerald-400">
                  ✓ Завершено — {closedReasonLabel(a.closed_reason)} ({a.attempts_used}/{a.max_attempts} попыток)
                </p>
              )
            : a.max_attempts > 1 && (
                <p>Попыток использовано: {a.attempts_used}/{a.max_attempts}</p>
              )}
        </div>

        <div className="pt-2 space-y-2">
          {isDone && (
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href={`/student/attempt/${a.assignment_id}/result`}>Посмотреть результат</Link>
            </Button>
          )}
          {isDone && canStart ? (
            <Button asChild size="sm" className="w-full">
              <Link href={`/student/attempt/${a.assignment_id}`}>Пройти ещё раз</Link>
            </Button>
          ) : !isDone && a.status === 'in_progress' ? (
            <Button asChild size="sm" className="w-full">
              <Link href={`/student/attempt/${a.assignment_id}`}>Продолжить</Link>
            </Button>
          ) : !isDone && canStart ? (
            <Button asChild size="sm" className="w-full">
              <Link href={`/student/attempt/${a.assignment_id}`}>Начать {a.kind === 'homework' ? 'ДЗ' : 'тест'}</Link>
            </Button>
          ) : !isDone && !canStart ? (
            <p className="text-xs text-muted-foreground text-center">
              {isClosed ? 'Завершено' : 'Попытки исчерпаны'}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center text-muted-foreground">
      <ClipboardList className="h-10 w-10 opacity-40" />
      <p>{text}</p>
    </div>
  )
}

type Tab = 'all' | 'test' | 'homework' | 'roadmap'

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'Всё' },
  { key: 'test', label: 'Тесты' },
  { key: 'homework', label: 'ДЗ' },
  { key: 'roadmap', label: 'Программа' },
]

export function StudentHome({
  assignments, roadmaps, initialTab,
}: {
  assignments: AssignmentCardData[]
  roadmaps: RoadmapGroup[]
  initialTab?: Tab
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'all')

  const filtered = tab === 'all' ? assignments : tab === 'roadmap' ? [] : assignments.filter(a => a.kind === tab)
  const hasRoadmaps = roadmaps.length > 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Мои задания</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Всё, что вам назначено — тесты, домашние задания и учебные программы
        </p>
      </div>

      <div className="flex gap-1 border-b">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ' +
              (tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'roadmap' ? (
        !hasRoadmaps ? (
          <EmptyState text="Вам пока не назначена ни одна программа." />
        ) : (
          <div className="space-y-8">
            {roadmaps.map(rm => (
              <section key={rm.id} className="space-y-2">
                <h2 className="text-lg font-semibold border-b pb-1">
                  {rm.title}{rm.subject ? ` · ${rm.subject}` : ''}
                </h2>
                <RoadmapTimeline topics={rm.topics} />
              </section>
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <EmptyState
          text={
            tab === 'test' ? 'Вам пока не назначено ни одного теста.'
            : tab === 'homework' ? 'Вам пока не назначено ни одного домашнего задания.'
            : 'Вам пока ничего не назначено.'
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(a => <AssignmentCard key={a.assignment_id} a={a} />)}
        </div>
      )}
    </div>
  )
}
