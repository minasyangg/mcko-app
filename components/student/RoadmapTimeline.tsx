import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TimelineItem {
  assignment_id: string
  test_title: string
  kind: 'homework' | 'test'
  status: string
  score: number | null
  max_score: number | null
  attempts_used: number
  max_attempts: number
  ends_at: string | null
}
export interface TimelineTopic {
  id: string
  title: string
  state: 'done' | 'active' | 'pending'
  items: TimelineItem[]
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

function ItemAction({ it }: { it: TimelineItem }) {
  const isDone = it.status === 'submitted' || it.status === 'checked'
  const attemptsLeft = it.max_attempts - it.attempts_used
  const canStart = attemptsLeft > 0 && !['in_progress', 'submitted'].includes(it.status)
  return (
    <div className="flex items-center gap-1.5">
      {isDone && (
        <Button asChild size="sm" variant="outline" className="h-7 text-xs">
          <Link href={`/student/attempt/${it.assignment_id}/result`}>Результат</Link>
        </Button>
      )}
      {it.status === 'in_progress' ? (
        <Button asChild size="sm" className="h-7 text-xs"><Link href={`/student/attempt/${it.assignment_id}`}>Продолжить</Link></Button>
      ) : !isDone && canStart ? (
        <Button asChild size="sm" className="h-7 text-xs"><Link href={`/student/attempt/${it.assignment_id}`}>Начать</Link></Button>
      ) : isDone && canStart ? (
        <Button asChild size="sm" variant="secondary" className="h-7 text-xs"><Link href={`/student/attempt/${it.assignment_id}`}>Ещё раз</Link></Button>
      ) : null}
    </div>
  )
}

export function RoadmapTimeline({ topics }: { topics: TimelineTopic[] }) {
  if (topics.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">В программе пока нет тем.</p>
  }
  return (
    <ol className="relative">
      {topics.map((t, i) => {
        const last = i === topics.length - 1
        return (
          <li key={t.id} className="relative pl-10 pb-6">
            {/* вертикальная линия */}
            {!last && <span className="absolute left-[15px] top-7 bottom-0 w-px bg-border" />}
            {/* узел темы */}
            <span className={cn(
              'absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold',
              t.state === 'done'
                ? 'bg-emerald-500 border-emerald-500 text-white'
                : t.state === 'active'
                  ? 'border-blue-500 text-blue-600 bg-background'
                  : 'border-border text-muted-foreground bg-background'
            )}>
              {t.state === 'done' ? <Check className="h-4 w-4" /> : i + 1}
            </span>

            <div className="pt-1">
              <h3 className={cn('font-medium', t.state === 'done' && 'text-muted-foreground')}>{t.title}</h3>
              <div className="mt-2 space-y-1.5">
                {t.items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Заданий нет</p>
                ) : (
                  t.items.map(it => (
                    <div key={it.assignment_id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
                      <Badge variant={it.kind === 'homework' ? 'outline' : 'secondary'} className="text-[11px] shrink-0">
                        {it.kind === 'homework' ? 'ДЗ' : 'Тест'}
                      </Badge>
                      <span className="text-sm flex-1 min-w-32 truncate">{it.test_title}</span>
                      <ItemStatus it={it} />
                      <ItemAction it={it} />
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
