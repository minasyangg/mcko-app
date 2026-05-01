'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface AttemptDetail {
  id: string
  status: string
  score: number | null
  max_score: number | null
  started_at: string | null
  submitted_at: string | null
  checked_at: string | null
  current_task_number: number | null
  teacher_comment: string | null
  profiles: {
    full_name: string
    grade: string | null
  } | null
  assignments: {
    test_versions: {
      version_number: number
      tests: {
        title: string
      } | null
    } | null
  } | null
}

interface AnswerRow {
  id: string
  task_id: string | null
  answer_json: unknown
  awarded_score: number | null
  is_correct: boolean | null
  teacher_comment: string | null
  test_tasks: {
    task_number: number
    task_type: string
    prompt_text: string
    max_score: number | null
  } | null
}

interface Props {
  attemptId: string | null
  onClose: () => void
}

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Не начата',
  in_progress: 'В процессе',
  submitted: 'Сдана',
  under_review: 'На проверке',
  checked: 'Проверена',
  expired: 'Истекла',
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  not_started: 'outline',
  in_progress: 'default',
  submitted: 'secondary',
  under_review: 'secondary',
  checked: 'outline',
  expired: 'destructive',
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function answerToString(json: unknown): string {
  if (json === null || json === undefined) return '—'
  if (typeof json === 'string') return json
  if (typeof json === 'number' || typeof json === 'boolean') return String(json)
  return JSON.stringify(json)
}

export function AttemptDrawer({ attemptId, onClose }: Props) {
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null)
  const [answers, setAnswers] = useState<AnswerRow[]>([])
  const [loading, setLoading] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    if (!attemptId) {
      setAttempt(null)
      setAnswers([])
      return
    }

    let cancelled = false
    setLoading(true)

    async function load() {
      const [attemptRes, answersRes] = await Promise.all([
        supabase
          .from('attempts')
          .select(`
            id, status, score, max_score, started_at, submitted_at, checked_at,
            current_task_number, teacher_comment,
            profiles ( full_name, grade ),
            assignments (
              test_versions (
                version_number,
                tests ( title )
              )
            )
          `)
          .eq('id', attemptId!)
          .single(),
        supabase
          .from('attempt_task_answers')
          .select(`
            id, task_id, answer_json, awarded_score, is_correct, teacher_comment,
            test_tasks ( task_number, task_type, prompt_text, max_score )
          `)
          .eq('attempt_id', attemptId!)
          .order('task_id'),
      ])

      if (cancelled) return

      if (!attemptRes.error && attemptRes.data) {
        setAttempt(attemptRes.data as unknown as AttemptDetail)
      }
      if (!answersRes.error && answersRes.data) {
        const sorted = [...(answersRes.data as unknown as AnswerRow[])].sort(
          (a, b) => (a.test_tasks?.task_number ?? 0) - (b.test_tasks?.task_number ?? 0)
        )
        setAnswers(sorted)
      }
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [attemptId])

  const open = attemptId !== null

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle>Детали попытки</SheetTitle>
        </SheetHeader>

        {loading && (
          <div className="space-y-3 px-4">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {!loading && attempt && (
          <div className="px-4 space-y-5">
            {/* Header info */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="font-medium text-base">
                  {attempt.profiles?.full_name ?? '—'}
                </span>
                {attempt.profiles?.grade && (
                  <span className="text-sm text-muted-foreground">
                    {attempt.profiles.grade} кл.
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {attempt.assignments?.test_versions?.tests?.title ?? '—'}
                {attempt.assignments?.test_versions && (
                  <span> · v{attempt.assignments.test_versions.version_number}</span>
                )}
              </p>
              <div className="flex items-center gap-3">
                <Badge variant={STATUS_VARIANTS[attempt.status] ?? 'outline'}>
                  {STATUS_LABELS[attempt.status] ?? attempt.status}
                </Badge>
                {attempt.score !== null && (
                  <span className="text-sm font-medium">
                    {attempt.score} / {attempt.max_score ?? '?'} баллов
                  </span>
                )}
              </div>
            </div>

            {/* Timing */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Начата:</span>{' '}
                {formatDate(attempt.started_at)}
              </div>
              <div>
                <span className="text-muted-foreground">Сдана:</span>{' '}
                {formatDate(attempt.submitted_at)}
              </div>
              <div>
                <span className="text-muted-foreground">Текущий вопрос:</span>{' '}
                {attempt.current_task_number ?? '—'}
              </div>
              <div>
                <span className="text-muted-foreground">Проверена:</span>{' '}
                {formatDate(attempt.checked_at)}
              </div>
            </div>

            {attempt.teacher_comment && (
              <div className="rounded-md bg-muted p-3 text-sm">
                <span className="font-medium">Комментарий учителя:</span>{' '}
                {attempt.teacher_comment}
              </div>
            )}

            {/* Answers table */}
            <div>
              <h3 className="text-sm font-medium mb-2">Ответы на задания</h3>
              {answers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ответы отсутствуют</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground w-10">№</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Ответ</th>
                        <th className="px-3 py-2 text-center font-medium text-muted-foreground w-20">Балл</th>
                        <th className="px-3 py-2 text-center font-medium text-muted-foreground w-20">Верно</th>
                      </tr>
                    </thead>
                    <tbody>
                      {answers.map((ans) => (
                        <tr key={ans.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-3 py-2 text-muted-foreground">
                            {ans.test_tasks?.task_number ?? '—'}
                          </td>
                          <td className="px-3 py-2 max-w-xs truncate">
                            <span title={answerToString(ans.answer_json)}>
                              {answerToString(ans.answer_json)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            {ans.awarded_score !== null
                              ? `${ans.awarded_score} / ${ans.test_tasks?.max_score ?? '?'}`
                              : '—'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {ans.is_correct === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : ans.is_correct ? (
                              <span className="text-green-600 font-medium">Да</span>
                            ) : (
                              <span className="text-red-500 font-medium">Нет</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {!loading && !attempt && attemptId && (
          <div className="px-4 text-sm text-muted-foreground">
            Не удалось загрузить данные попытки.
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
