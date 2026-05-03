import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { CheckCircle2, XCircle, MinusCircle, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react'
import type { Json } from '@/types/database'
import { enrichTaskMediaWithUrls } from '@/lib/media/signed-urls'
import { SolutionRequestButton } from '@/components/student/SolutionRequestButton'
import { SolutionView } from '@/components/test-player/SolutionView'

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

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const { data: assignment } = await supabase
    .from('assignments')
    .select(`id, student_id, group_id, test_version_id,
      test_versions!test_version_id ( id, result_visibility, tests!test_id ( id, title, subject, exam_type ) )`)
    .eq('id', assignmentId)
    .single()

  if (!assignment) redirect('/student')

  let hasAccess = assignment.student_id === user.id
  if (!hasAccess && assignment.group_id) {
    const { data: m } = await supabase
      .from('group_members').select('user_id')
      .eq('group_id', assignment.group_id).eq('user_id', user.id).single()
    hasAccess = !!m
  }
  if (!hasAccess) redirect('/student')

  const tv = assignment.test_versions as any
  const test = tv?.tests as any
  const resultVisibility: string = tv?.result_visibility ?? 'after_submit'

  const { data: attempts } = await supabase
    .from('attempts')
    .select('id, status, score, max_score, submitted_at, checked_at')
    .eq('assignment_id', assignmentId).eq('student_id', user.id)
    .in('status', ['submitted', 'checked'])
    .order('submitted_at', { ascending: false }).limit(1)

  const attempt = attempts?.[0]
  if (!attempt) redirect(`/student/attempt/${assignmentId}`)

  const score = attempt.score ?? 0
  const maxScore = attempt.max_score ?? 0
  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0
  const isChecked = attempt.status === 'checked'

  const showDetails =
    resultVisibility !== 'never' &&
    (resultVisibility === 'instant' || resultVisibility === 'after_submit' ||
      (resultVisibility === 'after_teacher_review' && isChecked))
  const pendingTeacherReview = resultVisibility === 'after_teacher_review' && !isChecked

  const { data: tasks } = await supabase
    .from('test_tasks')
    .select('id, task_number, prompt_text, max_score, task_type')
    .eq('test_version_id', assignment.test_version_id)
    .order('sort_order', { ascending: true })

  const { data: studentAnswers } = await supabase
    .from('attempt_task_answers')
    .select('task_id, answer_json, is_correct, awarded_score')
    .eq('attempt_id', attempt.id)

  const answerKeyMap = new Map<string, Json>()
  if (showDetails && isChecked && tasks) {
    const { data: keys } = await supabase
      .from('task_answer_keys').select('task_id, correct_answer')
      .in('task_id', tasks.map(t => t.id))
    for (const k of keys ?? []) if (k.task_id) answerKeyMap.set(k.task_id, k.correct_answer)
  }

  // Load which tasks have solutions
  const taskIds = (tasks ?? []).map(t => t.id)
  const { data: solutionsAvailable } = await supabase
    .from('task_solutions').select('task_id')
    .in('task_id', taskIds)
  const solutionTaskIds = new Set((solutionsAvailable ?? []).map(s => s.task_id).filter(Boolean))

  // Load solution requests for this attempt
  const { data: solRequests } = await supabase
    .from('solution_requests')
    .select('task_id, status, id')
    .eq('attempt_id', attempt.id).eq('student_id', user.id)

  type ReqStatus = 'none' | 'pending' | 'approved' | 'rejected'
  const requestStatusMap = new Map<string, ReqStatus>()
  for (const r of solRequests ?? []) {
    if (r.task_id) requestStatusMap.set(r.task_id, r.status as ReqStatus)
  }

  // Load full solutions + media for approved requests
  const approvedTaskIds = [...requestStatusMap.entries()]
    .filter(([, s]) => s === 'approved').map(([id]) => id)

  const solutionContentMap = new Map<string, { text: string | null; html: string | null; solutionId: string }>()
  const solutionMediaMap = new Map<string, Awaited<ReturnType<typeof enrichTaskMediaWithUrls>>>()

  if (approvedTaskIds.length > 0) {
    const { data: solutions } = await supabase
      .from('task_solutions')
      .select('id, task_id, solution_text, solution_html, has_images')
      .in('task_id', approvedTaskIds)

    for (const sol of solutions ?? []) {
      if (sol.task_id) {
        solutionContentMap.set(sol.task_id, {
          text: sol.solution_text,
          html: sol.solution_html,
          solutionId: sol.id,
        })
      }
    }

    // Load solution media
    const solutionIds = [...solutionContentMap.values()].map(s => s.solutionId)
    if (solutionIds.length > 0) {
      const { data: rawMedia } = await supabase
        .from('solution_media').select('*')
        .in('solution_id', solutionIds).order('sort_order')

      const mediaWithUrls = await enrichTaskMediaWithUrls(supabase, (rawMedia ?? []).map(m => ({
        id: m.id,
        task_id: null,
        storage_path: m.storage_path,
        media_type: m.media_type,
        original_filename: m.original_filename,
        width_px: m.width_px,
        height_px: m.height_px,
        file_size_bytes: m.file_size_bytes,
        format: m.format,
        placement: 'above_text' as const,
        sort_order: m.sort_order,
        alt_text: m.alt_text,
        source_page: m.source_page,
        source_bbox: null,
        is_manually_uploaded: false,
        created_at: m.created_at,
      })))

      // Group by solution_id → then by task
      for (const sol of solutions ?? []) {
        if (!sol.task_id) continue
        const taskMedia = mediaWithUrls.filter(m => {
          const raw = rawMedia?.find(r => r.storage_path === m.storage_path)
          return raw?.solution_id === sol.id
        })
        if (taskMedia.length > 0) solutionMediaMap.set(sol.task_id, taskMedia)
      }
    }
  }

  const answerMap = new Map((studentAnswers ?? []).map(a => [a.task_id, a]))

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">{test?.title ?? 'Тест'}</h1>
              <div className="flex items-center gap-2 mt-1">
                {test?.subject && <span className="text-sm text-muted-foreground">{test.subject}</span>}
                {test?.exam_type && <Badge variant="secondary">{test.exam_type}</Badge>}
              </div>
            </div>
            <Badge variant={isChecked ? 'default' : 'secondary'}>
              {isChecked ? 'Проверено' : 'Отправлено'}
            </Badge>
          </div>
        </div>

        {/* Score */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Результат</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-3">
              <span className="text-5xl font-bold tabular-nums">{score}</span>
              <span className="text-2xl text-muted-foreground mb-1">/ {maxScore}</span>
              <span className="text-2xl font-semibold text-muted-foreground mb-1">({percentage}%)</span>
            </div>
            <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={['h-full rounded-full transition-all',
                  percentage >= 80 ? 'bg-green-500' : percentage >= 60 ? 'bg-orange-400' : 'bg-destructive'
                ].join(' ')}
                style={{ width: `${percentage}%` }}
              />
            </div>
            {attempt.submitted_at && (
              <p className="text-xs text-muted-foreground">
                Отправлено: {new Date(attempt.submitted_at).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            )}
          </CardContent>
        </Card>

        {pendingTeacherReview && (
          <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/30">
            <CardContent className="pt-6">
              <p className="text-sm text-orange-700 dark:text-orange-300">
                Результаты будут доступны после проверки учителем.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Tasks */}
        {showDetails && tasks && tasks.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Детали по задачам</h2>
            <div className="space-y-3">
              {tasks.map((task) => {
                const ans = answerMap.get(task.id)
                const isCorrect = ans?.is_correct
                const awardedScore = ans?.awarded_score ?? 0
                const reqStatus = requestStatusMap.get(task.id) ?? 'none'
                const hasSolution = solutionTaskIds.has(task.id)
                const solutionContent = solutionContentMap.get(task.id)
                const solutionMedia = solutionMediaMap.get(task.id) ?? []

                return (
                  <Card
                    key={task.id}
                    className={[
                      isChecked && isCorrect === true ? 'border-green-200 dark:border-green-800' :
                      isChecked && isCorrect === false ? 'border-red-200 dark:border-red-800' : ''
                    ].join(' ')}
                  >
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex items-start gap-3">
                        {/* Status icon */}
                        <div className="mt-0.5 shrink-0">
                          {isChecked && isCorrect === true ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : isChecked && isCorrect === false ? (
                            <XCircle className="h-4 w-4 text-destructive" />
                          ) : (
                            <MinusCircle className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              Задача {task.task_number}
                            </span>
                            {isChecked && (
                              <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                                <span className="font-semibold text-foreground">{awardedScore}</span>/{task.max_score} б.
                              </span>
                            )}
                          </div>
                          <p className="text-sm line-clamp-2">{task.prompt_text}</p>
                          <p className="text-sm">
                            <span className="text-muted-foreground">Ваш ответ: </span>
                            <span className="font-medium">{formatAnswer(ans?.answer_json ?? null)}</span>
                          </p>
                        </div>
                      </div>

                      {/* Solution request button */}
                      {hasSolution && (
                        <div className="flex items-center justify-between pt-1 border-t">
                          <SolutionRequestButton
                            attemptId={attempt.id}
                            taskId={task.id}
                            taskNumber={task.task_number}
                            initialStatus={reqStatus}
                          />
                        </div>
                      )}

                      {/* Approved solution */}
                      {reqStatus === 'approved' && solutionContent && (
                        <div className="rounded-md border bg-muted/30 p-4 space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Разбор задачи
                          </p>
                          <SolutionView
                            solutionText={solutionContent.text}
                            solutionHtml={solutionContent.html}
                            media={solutionMedia}
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        )}

        <Separator />
        <Button variant="outline" asChild>
          <Link href="/student">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Вернуться к списку тестов
          </Link>
        </Button>
      </div>
    </div>
  )
}
