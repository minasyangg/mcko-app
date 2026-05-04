import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ClipboardList } from 'lucide-react'
import Link from 'next/link'

type AttemptStatus = 'not_started' | 'in_progress' | 'submitted' | 'checked'

function StatusBadge({ status, score, maxScore }: { status: AttemptStatus; score?: number | null; maxScore?: number | null }) {
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

export default async function StudentHomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: memberships } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', user.id)

  const groupIds = (memberships ?? []).map((m) => m.group_id as string)

  let query = supabase
    .from('assignments')
    .select(`
      id, starts_at, ends_at, max_attempts,
      test_versions!test_version_id (
        id, time_limit_sec,
        tests!test_id ( id, title, subject, exam_type )
      )
    `)

  if (groupIds.length > 0) {
    query = query.or(`student_id.eq.${user.id},group_id.in.(${groupIds.join(',')})`)
  } else {
    query = query.eq('student_id', user.id)
  }

  const { data: assignments } = await query.order('created_at', { ascending: false })

  // Load all attempts for these assignments in one query
  const assignmentIds = (assignments ?? []).map((a) => a.id)
  const { data: attempts } = assignmentIds.length > 0
    ? await supabase
        .from('attempts')
        .select('id, assignment_id, status, score, max_score')
        .in('assignment_id', assignmentIds)
        .eq('student_id', user.id)
        .order('created_at', { ascending: false })
    : { data: [] }

  type AttemptRow = { id: string; assignment_id: string | null; status: string; score: number | null; max_score: number | null }
  // Group attempts by assignment_id, keep latest per assignment
  const attemptMap = new Map<string, AttemptRow>()
  for (const a of (attempts ?? []) as AttemptRow[]) {
    if (a.assignment_id && !attemptMap.has(a.assignment_id)) {
      attemptMap.set(a.assignment_id, a)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Мои тесты</h1>
        <p className="text-muted-foreground text-sm mt-1">Назначенные вам тесты</p>
      </div>

      {!assignments?.length ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center text-muted-foreground">
          <ClipboardList className="h-10 w-10 opacity-40" />
          <p>Вам пока не назначено ни одного теста.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assignments.map((a) => {
            const tv = a.test_versions as any
            const test = tv?.tests as any
            const attempt = attemptMap.get(a.id)

            const attemptStatus: AttemptStatus = (attempt?.status as AttemptStatus) ?? 'not_started'
            const isDone = attemptStatus === 'submitted' || attemptStatus === 'checked'
            const attemptsUsed = (attempts ?? []).filter(
              (at) => at.assignment_id === a.id && (at.status === 'submitted' || at.status === 'checked')
            ).length
            const attemptsLeft = (a.max_attempts ?? 1) - attemptsUsed
            const canStart = attemptsLeft > 0 && !['in_progress', 'submitted'].includes(attemptStatus)

            return (
              <Card key={a.id} className="flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-tight">{test?.title ?? 'Тест'}</CardTitle>
                    {test?.exam_type && <Badge variant="secondary" className="shrink-0">{test.exam_type}</Badge>}
                  </div>
                  {test?.subject && <CardDescription>{test.subject}</CardDescription>}
                </CardHeader>
                <CardContent className="flex-1 text-sm text-muted-foreground space-y-2">
                  <StatusBadge
                    status={attemptStatus}
                    score={attempt?.score}
                    maxScore={attempt?.max_score}
                  />

                  <div className="space-y-1 text-xs">
                    {tv?.time_limit_sec && (
                      <p>Время: {Math.round(tv.time_limit_sec / 60)} мин</p>
                    )}
                    {a.ends_at && (
                      <p>До: {new Date(a.ends_at).toLocaleDateString('ru-RU')}</p>
                    )}
                    <p>Попыток: {attemptsUsed}/{a.max_attempts ?? 1}</p>
                  </div>

                  <div className="pt-2 space-y-2">
                    {isDone && (
                      <Button asChild variant="outline" size="sm" className="w-full">
                        <Link href={`/student/attempt/${a.id}/result`}>Посмотреть результат</Link>
                      </Button>
                    )}
                    {isDone && canStart ? (
                      <Button asChild size="sm" className="w-full">
                        <Link href={`/student/attempt/${a.id}`}>Пройти ещё раз</Link>
                      </Button>
                    ) : !isDone && attemptStatus === 'in_progress' ? (
                      <Button asChild size="sm" className="w-full">
                        <Link href={`/student/attempt/${a.id}`}>Продолжить</Link>
                      </Button>
                    ) : !isDone && canStart ? (
                      <Button asChild size="sm" className="w-full">
                        <Link href={`/student/attempt/${a.id}`}>Начать тест</Link>
                      </Button>
                    ) : !isDone && !canStart ? (
                      <p className="text-xs text-muted-foreground text-center">Попытки исчерпаны</p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
