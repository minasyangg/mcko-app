import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { CheckCircle2, XCircle, MinusCircle, ArrowLeft } from 'lucide-react'
import type { Json } from '@/types/database'

interface PageProps {
  params: Promise<{ id: string }>
}

function formatAnswer(answerJson: Json | null): string {
  if (answerJson === null || answerJson === undefined) return '—'
  if (typeof answerJson === 'string') return answerJson
  if (typeof answerJson === 'number') return String(answerJson)
  if (typeof answerJson === 'boolean') return answerJson ? 'Да' : 'Нет'
  if (Array.isArray(answerJson)) return answerJson.join(', ')
  if (typeof answerJson === 'object') {
    const obj = answerJson as Record<string, Json | undefined>
    if ('selected' in obj) {
      const sel = obj['selected']
      if (Array.isArray(sel)) return sel.join(', ')
      return String(sel ?? '—')
    }
    if ('text' in obj) return String(obj['text'] ?? '—')
    if ('value' in obj) return String(obj['value'] ?? '—')
    if ('parts' in obj) {
      const parts = obj['parts']
      if (parts !== null && typeof parts === 'object' && !Array.isArray(parts)) {
        return Object.entries(parts as Record<string, Json | undefined>)
          .map(([k, v]) => `${k}: ${String(v ?? '')}`)
          .join('; ')
      }
    }
  }
  return JSON.stringify(answerJson)
}

export default async function ResultPage({ params }: PageProps) {
  const { id: assignmentId } = await params
  const supabase = await createClient()

  // Auth check
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  // Load assignment + test_version + test
  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select(`
      id,
      student_id,
      group_id,
      test_version_id,
      test_versions (
        id,
        result_visibility,
        tests (
          id,
          title,
          subject,
          exam_type
        )
      )
    `)
    .eq('id', assignmentId)
    .single()

  if (assignmentError || !assignment) {
    redirect('/student')
  }

  // Check access
  let hasAccess = assignment.student_id === user.id

  if (!hasAccess && assignment.group_id) {
    const { data: membership } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', assignment.group_id)
      .eq('user_id', user.id)
      .single()
    hasAccess = !!membership
  }

  if (!hasAccess) {
    redirect('/student')
  }

  const tv = assignment.test_versions as any
  const test = tv?.tests as any
  const resultVisibility: string = tv?.result_visibility ?? 'after_submit'

  // Find the latest submitted/checked attempt for this student + assignment
  const { data: attempts } = await supabase
    .from('attempts')
    .select('id, status, score, max_score, submitted_at, checked_at')
    .eq('assignment_id', assignmentId)
    .eq('student_id', user.id)
    .in('status', ['submitted', 'checked'])
    .order('submitted_at', { ascending: false })
    .limit(1)

  const attempt = attempts?.[0]

  if (!attempt) {
    redirect(`/student/attempt/${assignmentId}`)
  }

  const score = attempt.score ?? 0
  const maxScore = attempt.max_score ?? 0
  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0
  const isChecked = attempt.status === 'checked'

  // Determine if we can show task details
  const showDetails =
    resultVisibility !== 'never' &&
    (resultVisibility === 'instant' ||
      resultVisibility === 'after_submit' ||
      (resultVisibility === 'after_teacher_review' && isChecked))

  const pendingTeacherReview =
    resultVisibility === 'after_teacher_review' && !isChecked

  // Load tasks
  const { data: tasks } = await supabase
    .from('test_tasks')
    .select('id, task_number, prompt_text, max_score, task_type')
    .eq('test_version_id', assignment.test_version_id)
    .order('sort_order', { ascending: true })

  // Load student answers for this attempt
  const { data: studentAnswers } = await supabase
    .from('attempt_task_answers')
    .select('task_id, answer_json, is_correct, awarded_score')
    .eq('attempt_id', attempt.id)

  // Load answer keys (only if checked and we can show details)
  const answerKeyMap = new Map<string, Json>()
  if (showDetails && isChecked && tasks) {
    const taskIds = tasks.map((t) => t.id)
    const { data: answerKeys } = await supabase
      .from('task_answer_keys')
      .select('task_id, correct_answer')
      .in('task_id', taskIds)
    for (const key of answerKeys ?? []) {
      if (key.task_id) answerKeyMap.set(key.task_id, key.correct_answer)
    }
  }

  const answerMap = new Map(
    (studentAnswers ?? []).map((a) => [a.task_id, a])
  )

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">{test?.title ?? 'Тест'}</h1>
              <div className="flex items-center gap-2 mt-1">
                {test?.subject && (
                  <span className="text-sm text-muted-foreground">{test.subject}</span>
                )}
                {test?.exam_type && (
                  <Badge variant="secondary">{test.exam_type}</Badge>
                )}
              </div>
            </div>
            <Badge variant={isChecked ? 'default' : 'secondary'}>
              {isChecked ? 'Проверено' : 'Отправлено'}
            </Badge>
          </div>
        </div>

        {/* Score card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Результат</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-3">
              <span className="text-5xl font-bold tabular-nums">{score}</span>
              <span className="text-2xl text-muted-foreground mb-1">/ {maxScore}</span>
              <span className="text-2xl font-semibold text-muted-foreground mb-1">
                ({percentage}%)
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={[
                  'h-full rounded-full transition-all',
                  percentage >= 80
                    ? 'bg-green-500'
                    : percentage >= 60
                    ? 'bg-orange-400'
                    : 'bg-destructive',
                ].join(' ')}
                style={{ width: `${percentage}%` }}
              />
            </div>

            {attempt.submitted_at && (
              <p className="text-xs text-muted-foreground">
                Отправлено:{' '}
                {new Date(attempt.submitted_at).toLocaleString('ru-RU', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Pending teacher review notice */}
        {pendingTeacherReview && (
          <Card className="border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30">
            <CardContent className="pt-6">
              <p className="text-sm text-orange-700 dark:text-orange-300">
                Результаты будут доступны после проверки учителем.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Task details table */}
        {showDetails && tasks && tasks.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Детали по задачам</h2>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground w-12">№</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Задача</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Ваш ответ</th>
                    {isChecked && (
                      <>
                        <th className="px-4 py-3 text-center font-medium text-muted-foreground w-24">Баллы</th>
                        <th className="px-4 py-3 text-center font-medium text-muted-foreground w-10"></th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task, idx) => {
                    const ans = answerMap.get(task.id)
                    const isCorrect = ans?.is_correct
                    const awardedScore = ans?.awarded_score ?? 0

                    return (
                      <tr
                        key={task.id}
                        className={[
                          'border-b last:border-0',
                          isChecked && isCorrect === true
                            ? 'bg-green-50/50 dark:bg-green-950/20'
                            : isChecked && isCorrect === false
                            ? 'bg-red-50/50 dark:bg-red-950/20'
                            : '',
                        ].join(' ')}
                      >
                        <td className="px-4 py-3 text-muted-foreground font-mono">{task.task_number}</td>
                        <td className="px-4 py-3">
                          <span className="line-clamp-2 text-sm">{task.prompt_text}</span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className="text-foreground">
                            {formatAnswer(ans?.answer_json ?? null)}
                          </span>
                        </td>
                        {isChecked && (
                          <>
                            <td className="px-4 py-3 text-center tabular-nums">
                              <span className="font-medium">{awardedScore}</span>
                              <span className="text-muted-foreground">/{task.max_score}</span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              {isCorrect === true ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                              ) : isCorrect === false ? (
                                <XCircle className="h-4 w-4 text-destructive mx-auto" />
                              ) : (
                                <MinusCircle className="h-4 w-4 text-muted-foreground mx-auto" />
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer */}
        <Separator />
        <div className="flex justify-start">
          <Button variant="outline" asChild>
            <Link href="/student">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Вернуться к списку тестов
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
