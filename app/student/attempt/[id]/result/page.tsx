import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle, MinusCircle, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react'
import type { Json } from '@/types/database'
import { enrichTaskMediaWithUrls, generateSignedUrls } from '@/lib/media/signed-urls'
import { SolutionRequestButton } from '@/components/student/SolutionRequestButton'
import { SolutionView } from '@/components/test-player/SolutionView'
import { MathText } from '@/components/shared/MathText'
import MarkdownContent from '@/components/shared/MarkdownContent'
import type { TaskMedia } from '@/types/domain'
import { formatAnswerJson } from '@/lib/grading/format-answer-display'
import { closedReasonLabel } from '@/lib/assignments/completion'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ResultPage({ params }: PageProps) {
  const { id: assignmentId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const { data: assignment } = await supabase
    .from('assignments')
    .select(`id, student_id, group_id, test_version_id, roadmap_topic_id, max_attempts, closed_at, created_at,
      test_versions!test_version_id ( id, result_visibility, tests!test_id ( id, title, subject, exam_type ) )`)
    .eq('id', assignmentId)
    .single()

  if (!assignment) redirect('/student')

  // Задание из учебной программы — определяет, куда ведёт кнопка "назад".
  // Названия программы/темы не нужны: подписи у кнопки фиксированные.
  const fromRoadmap = assignment.roadmap_topic_id != null

  // Правило «вступил в группу больше чем на 3 дня позже создания назначения»
  // (см. миграцию 058) применяется единообразно и здесь: если само
  // назначение скрыто из «Мои тесты», уже полученный по нему результат тоже
  // недоступен по прямой ссылке — не оставляем половинчатого состояния, при
  // котором тест не виден в списке, но результат по нему открывается напрямую.
  let hasAccess = assignment.student_id === user.id
  if (!hasAccess && assignment.group_id) {
    const { data: m } = await supabase
      .from('group_members').select('user_id, added_at')
      .eq('group_id', assignment.group_id).eq('user_id', user.id).single()
    const joinedLate = !!m?.added_at &&
      new Date(m.added_at).getTime() > new Date(assignment.created_at ?? 0).getTime() + 3 * 24 * 60 * 60 * 1000
    hasAccess = !!m && !joinedLate
  }
  if (!hasAccess) redirect('/student')

  const tv = assignment.test_versions as any
  const test = tv?.tests as any
  const resultVisibility: string = tv?.result_visibility ?? 'after_submit'

  const { data: attempts } = await supabase
    .from('attempts')
    .select('id, status, score, max_score, submitted_at, checked_at, teacher_comment')
    .eq('assignment_id', assignmentId).eq('student_id', user.id)
    .in('status', ['submitted', 'checked'])
    .order('submitted_at', { ascending: false }).limit(1)

  const attempt = attempts?.[0]
  if (!attempt) redirect(`/student/attempt/${assignmentId}`)

  // Накопительный итог — по НАЗНАЧЕНИЮ, а не по версии теста: тот же тест
  // может быть назначен ученику ещё раз (например, через тему программы), и
  // фильтр по test_version_id подхватывал бы чужой итог (см. миграцию 032).
  const { data: finalResult } = await supabase
    .from('student_final_results')
    .select('final_score, max_score, attempt_count, status, closed_reason')
    .eq('student_id', user.id)
    .eq('assignment_id', assignmentId)
    .maybeSingle()

  const completedAttempts = finalResult?.attempt_count ?? 1
  const maxAttempts = assignment.max_attempts ?? 1
  const attemptsLeft = Math.max(0, maxAttempts - completedAttempts)
  // Назначение закрывается не только исчерпанием попыток: полный балл и
  // принудительное завершение учителем тоже (миграция 038). closed_at на самом
  // назначении — закрытие «для всех», обычно вместе с closed_reason у ученика,
  // но строка итога может ещё не существовать (ученик не приступал).
  const closedReason =
    finalResult?.closed_reason ?? (assignment.closed_at ? 'forced' : null)
  const isCompleted = closedReason != null || finalResult?.status === 'completed' || attemptsLeft <= 0
  const completionNote = closedReasonLabel(closedReason)

  // Use cumulative score if available, otherwise fall back to attempt score
  const score = finalResult?.final_score ?? attempt.score ?? 0
  const maxScore = finalResult?.max_score ?? attempt.max_score ?? 0
  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0
  const isChecked = attempt.status === 'checked'

  const showDetails =
    resultVisibility !== 'never' &&
    (resultVisibility === 'instant' || resultVisibility === 'after_submit' ||
      (resultVisibility === 'after_teacher_review' && isChecked))
  const pendingTeacherReview = resultVisibility === 'after_teacher_review' && !isChecked

  const { data: tasks } = await supabase
    .from('test_tasks')
    .select('id, task_number, prompt_text, prompt_html, max_score, task_type')
    .eq('test_version_id', assignment.test_version_id)
    .order('sort_order', { ascending: true })

  const { data: studentAnswers } = await supabase
    .from('attempt_task_answers')
    .select('task_id, answer_json, is_correct, awarded_score, teacher_comment, is_locked, auto_checked_at')
    .eq('attempt_id', attempt.id)

  // Load task images for result page display
  const taskMediaByTaskId = new Map<string, { url: string; alt: string | null }[]>()
  const taskIdsForMedia = (tasks ?? []).map(t => t.id)
  if (taskIdsForMedia.length > 0) {
    const { data: rawMedia } = await supabase
      .from('task_media')
      .select('id, task_id, storage_path, media_type, original_filename, width_px, height_px, file_size_bytes, format, placement, sort_order, alt_text, source_page, source_bbox, is_manually_uploaded, created_at')
      .in('task_id', taskIdsForMedia)
      .order('sort_order', { ascending: true })
    if (rawMedia?.length) {
      const enriched = await enrichTaskMediaWithUrls(supabase, rawMedia as TaskMedia[])
      for (const m of enriched) {
        if (!m.task_id || !m.signedUrl) continue
        if (!taskMediaByTaskId.has(m.task_id)) taskMediaByTaskId.set(m.task_id, [])
        taskMediaByTaskId.get(m.task_id)!.push({ url: m.signedUrl, alt: m.alt_text })
      }
    }
  }

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

      // solution-media — приватный bucket без прямого доступа для роли student
      // (см. storage-политику); URL подписываем service-role клиентом — доступ
      // уже проверен выше через approvedTaskIds (student's own approved request)
      const admin = createAdminClient()
      const urlByPath = await generateSignedUrls(admin, (rawMedia ?? []).map(m => ({
        storage_path: m.storage_path,
        bucket: 'solution-media' as const,
      })))
      const mediaWithUrls = (rawMedia ?? []).map(m => ({
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
        signedUrl: urlByPath[m.storage_path] ?? '',
      }))

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

  // Кнопка "назад" зависит от того, пришло ли задание из программы (roadmap)
  // или из обычного списка тестов — раньше она всегда вела на /student
  // независимо от происхождения, теряя контекст. Хлебных крошек здесь
  // намеренно нет: последний уровень дублировал заголовок страницы, а сама
  // цепочка ничего не добавляла к одной кнопке возврата.
  const backHref = fromRoadmap ? '/student/roadmap' : '/student'
  const backLabel = fromRoadmap ? 'Вернуться в программы' : 'Вернуться к списку тестов'

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-8">
        <Button variant="outline" size="sm" asChild>
          <Link href={backHref}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {backLabel}
          </Link>
        </Button>

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
        <Card className={isCompleted ? 'border-emerald-300' : !isChecked ? 'border-orange-200' : ''}>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              {isCompleted ? 'Итоговый результат' : attemptsLeft > 0 ? 'Текущий результат' : 'Результат'}
              {isCompleted && (
                <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                  Тест завершён
                </Badge>
              )}
              {!isCompleted && !isChecked && (
                <Badge variant="secondary" className="text-orange-600 bg-orange-100 dark:bg-orange-950/40">
                  Ожидает проверки учителем
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
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
            {!isCompleted && attemptsLeft > 0 && (
              <p className="text-sm text-muted-foreground">
                Накопленный балл за {completedAttempts} попыт{completedAttempts === 1 ? 'ку' : completedAttempts < 5 ? 'ки' : 'ок'}. Осталось попыток: <strong>{attemptsLeft}</strong>.
              </p>
            )}
            {/* Почему тест закрыт — важно, когда попытки формально остались:
                иначе «Тест завершён» рядом с «осталось 2 попытки» читается
                как ошибка системы */}
            {isCompleted && completionNote && (
              <p className="text-sm text-muted-foreground">
                Тест завершён: {completionNote}
                {attemptsLeft > 0 && closedReason !== 'attempts_exhausted' && (
                  <> — неиспользованные попытки ({attemptsLeft}) больше не доступны.</>
                )}
              </p>
            )}
            {!isChecked && !isCompleted && (
              <p className="text-xs text-orange-700 dark:text-orange-400">
                Задания на ручную проверку ожидают учителя — балл может вырасти.
              </p>
            )}
            {attempt.submitted_at && (
              <p className="text-xs text-muted-foreground">
                Отправлено: {new Date(attempt.submitted_at).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            )}
            {isChecked && (attempt as any).teacher_comment && (
              <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 px-4 py-3 text-sm">
                <p className="font-medium text-yellow-800 dark:text-yellow-300 mb-1">Комментарий учителя к работе:</p>
                <MathText text={(attempt as any).teacher_comment} className="text-yellow-900 dark:text-yellow-200" />
              </div>
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
                // Show ✓/✗ for tasks that are resolved: locked (from prior attempt),
                // auto-graded in current attempt, or teacher has finalized everything
                const isResolved = isChecked || ans?.is_locked === true || ans?.auto_checked_at != null

                return (
                  <Card
                    key={task.id}
                    className={[
                      isResolved && isCorrect === true ? 'border-green-200 dark:border-green-800' :
                      isResolved && isCorrect === false ? 'border-red-200 dark:border-red-800' : ''
                    ].join(' ')}
                  >
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex items-start gap-3">
                        {/* Status icon */}
                        <div className="mt-0.5 shrink-0">
                          {isResolved && isCorrect === true ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : isResolved && isCorrect === false ? (
                            <XCircle className="h-4 w-4 text-destructive" />
                          ) : (
                            <MinusCircle className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              Задача {task.task_number}
                            </span>
                            {isResolved && (
                              <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                                <span className="font-semibold text-foreground">{awardedScore}</span>/{task.max_score} б.
                              </span>
                            )}
                          </div>
                          {/* Task images */}
                          {(() => {
                            const imgs = taskMediaByTaskId.get(task.id) ?? []
                            return imgs.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {imgs.map((img, i) => (
                                  <img key={i} src={img.url} alt={img.alt ?? ''} className="max-h-48 rounded border object-contain bg-muted" />
                                ))}
                              </div>
                            ) : null
                          })()}
                          {/* Task text with formulas */}
                          <div className="text-sm">
                            {(task as any).prompt_html
                              ? <MarkdownContent content={(task as any).prompt_html} />
                              : <p>{task.prompt_text}</p>
                            }
                          </div>
                          <p className="text-sm">
                            <span className="text-muted-foreground">Ваш ответ: </span>
                            <span className="font-medium">{formatAnswerJson(ans?.answer_json ?? null)}</span>
                          </p>
                          {isChecked && ans?.teacher_comment && (
                            <div className="rounded bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 px-3 py-2 text-sm">
                              <span className="font-medium text-yellow-800 dark:text-yellow-300 mr-1">Комментарий учителя:</span>
                              <span className="text-yellow-900 dark:text-yellow-200">{ans.teacher_comment}</span>
                            </div>
                          )}
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

      </div>
    </div>
  )
}
