'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle2, XCircle, MinusCircle, Loader2 } from 'lucide-react'
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
  profiles: { full_name: string; grade: string | null } | null
  assignments: {
    test_versions: { version_number: number; tests: { title: string } | null } | null
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
  onGraded?: (attemptId: string) => void
}

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Не начата', in_progress: 'В процессе',
  submitted: 'На проверке', under_review: 'На проверке',
  checked: 'Проверена', expired: 'Истекла',
}

function formatDt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function answerToString(json: unknown): string {
  if (json === null || json === undefined) return '—'
  if (typeof json === 'string') return json
  if (typeof json === 'number' || typeof json === 'boolean') return String(json)
  if (typeof json === 'object') {
    const o = json as Record<string, unknown>
    if (o.text !== undefined) return String(o.text)
    if (o.value !== undefined) return String(o.value)
    if (o.selected !== undefined) {
      return Array.isArray(o.selected) ? o.selected.join(', ') : String(o.selected)
    }
    if (o.parts !== undefined && typeof o.parts === 'object') {
      return Object.entries(o.parts as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${v}`).join('; ')
    }
  }
  return JSON.stringify(json)
}

interface GradeState {
  score: string
  comment: string
}

export function AttemptDrawer({ attemptId, onClose, onGraded }: Props) {
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null)
  const [answers, setAnswers] = useState<AnswerRow[]>([])
  const [loading, setLoading] = useState(false)
  const [grades, setGrades] = useState<Record<string, GradeState>>({})
  const [teacherComment, setTeacherComment] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    if (!attemptId) { setAttempt(null); setAnswers([]); setGrades({}); return }
    let cancelled = false
    setLoading(true); setSaveError(null)

    async function load() {
      const [attemptRes, answersRes] = await Promise.all([
        supabase.from('attempts').select(`
          id, status, score, max_score, started_at, submitted_at, checked_at,
          current_task_number, teacher_comment,
          profiles ( full_name, grade ),
          assignments ( test_versions!test_version_id (
            version_number, tests!test_id ( title )
          ))
        `).eq('id', attemptId!).single(),
        supabase.from('attempt_task_answers').select(`
          id, task_id, answer_json, awarded_score, is_correct, teacher_comment,
          test_tasks ( task_number, task_type, prompt_text, max_score )
        `).eq('attempt_id', attemptId!),
      ])
      if (cancelled) return

      if (!attemptRes.error && attemptRes.data) {
        const a = attemptRes.data as unknown as AttemptDetail
        setAttempt(a)
        setTeacherComment(a.teacher_comment ?? '')
      }
      if (!answersRes.error && answersRes.data) {
        const sorted = [...(answersRes.data as unknown as AnswerRow[])].sort(
          (a, b) => (a.test_tasks?.task_number ?? 0) - (b.test_tasks?.task_number ?? 0)
        )
        setAnswers(sorted)
        // Initialize grade state for manual_review tasks
        const init: Record<string, GradeState> = {}
        for (const ans of sorted) {
          if (ans.test_tasks?.task_type === 'manual_review' || ans.awarded_score === null) {
            init[ans.id] = {
              score: String(ans.awarded_score ?? 0),
              comment: ans.teacher_comment ?? '',
            }
          }
        }
        setGrades(init)
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [attemptId])

  const needsGrading = ['submitted', 'under_review'].includes(attempt?.status ?? '')
  const manualAnswers = answers.filter((a) => a.test_tasks?.task_type === 'manual_review')

  const handleFinalize = async () => {
    if (!attemptId) return
    setIsSaving(true); setSaveError(null)
    try {
      const gradeUpdates = Object.entries(grades).map(([answerId, g]) => ({
        answer_id: answerId,
        awarded_score: parseFloat(g.score) || 0,
        is_correct: (parseFloat(g.score) || 0) > 0,
        teacher_comment: g.comment || undefined,
      }))
      const res = await fetch(`/api/attempts/${attemptId}/grade`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: gradeUpdates,
          finalize: true,
          teacher_comment: teacherComment || undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setSaveError(d.error ?? 'Ошибка сохранения')
        return
      }
      onGraded?.(attemptId)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Sheet open={!!attemptId} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle>Попытка студента</SheetTitle>
        </SheetHeader>

        {loading && (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-5 w-full" />)}
          </div>
        )}

        {!loading && attempt && (
          <div className="p-4 space-y-6">
            {/* Header */}
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-base">{attempt.profiles?.full_name ?? '—'}</p>
                  {attempt.profiles?.grade && (
                    <p className="text-sm text-muted-foreground">{attempt.profiles.grade} класс</p>
                  )}
                </div>
                <Badge variant={needsGrading ? 'secondary' : 'outline'}>
                  {STATUS_LABELS[attempt.status] ?? attempt.status}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {attempt.assignments?.test_versions?.tests?.title ?? '—'}
              </p>
              {attempt.score !== null && (
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold tabular-nums">{attempt.score}</span>
                  <span className="text-muted-foreground">/ {attempt.max_score ?? '?'} баллов</span>
                  {(attempt.max_score ?? 0) > 0 && (
                    <span className={cn(
                      'text-sm font-semibold',
                      (attempt.score / (attempt.max_score!)) >= 0.8 ? 'text-green-600' :
                      (attempt.score / (attempt.max_score!)) >= 0.6 ? 'text-orange-500' : 'text-destructive'
                    )}>
                      {Math.round((attempt.score / attempt.max_score!) * 100)}%
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Timing */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <div><span className="text-muted-foreground">Начата:</span> {formatDt(attempt.started_at)}</div>
              <div><span className="text-muted-foreground">Сдана:</span> {formatDt(attempt.submitted_at)}</div>
              <div><span className="text-muted-foreground">Проверена:</span> {formatDt(attempt.checked_at)}</div>
              <div><span className="text-muted-foreground">Задание:</span> {attempt.current_task_number ?? '—'}</div>
            </div>

            {/* Answers */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Ответы на задания ({answers.length})</h3>
              <div className="space-y-2">
                {answers.map((ans) => {
                  const isManual = ans.test_tasks?.task_type === 'manual_review'
                  const g = grades[ans.id]
                  return (
                    <div
                      key={ans.id}
                      className={cn(
                        'rounded-md border p-3 space-y-2',
                        ans.is_correct === true && 'border-green-200 bg-green-50/30',
                        ans.is_correct === false && !isManual && 'border-red-100 bg-red-50/20',
                        isManual && needsGrading && 'border-orange-200 bg-orange-50/20',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-semibold bg-muted px-1.5 py-0.5 rounded">
                            №{ans.test_tasks?.task_number ?? '?'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {ans.test_tasks?.task_type === 'manual_review' ? 'Развёрнутый' :
                             ans.test_tasks?.task_type === 'single_choice' ? 'Один ответ' :
                             ans.test_tasks?.task_type === 'multiple_choice' ? 'Несколько' :
                             ans.test_tasks?.task_type === 'numeric' ? 'Число' : 'Текст'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {ans.is_correct === true && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                          {ans.is_correct === false && !isManual && <XCircle className="h-4 w-4 text-red-400" />}
                          {(ans.is_correct === null || isManual) && <MinusCircle className="h-4 w-4 text-muted-foreground" />}
                          <span className="text-xs font-medium tabular-nums">
                            {isManual && needsGrading ? (
                              <span className="text-orange-600">нужна проверка</span>
                            ) : (
                              `${ans.awarded_score ?? '—'} / ${ans.test_tasks?.max_score ?? '?'}`
                            )}
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {ans.test_tasks?.prompt_text}
                      </p>

                      <div className="text-sm bg-muted/50 rounded px-2 py-1.5">
                        <span className="text-xs text-muted-foreground mr-1">Ответ:</span>
                        <span className="font-medium wrap-break-word">{answerToString(ans.answer_json)}</span>
                      </div>

                      {/* Teacher grading for manual tasks */}
                      {isManual && g && (
                        <div className="space-y-2 pt-1 border-t">
                          <p className="text-xs font-medium text-orange-700">Выставить оценку:</p>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={0}
                              max={ans.test_tasks?.max_score ?? 10}
                              value={g.score}
                              onChange={(e) => setGrades((prev) => ({
                                ...prev,
                                [ans.id]: { ...prev[ans.id], score: e.target.value }
                              }))}
                              className="w-20 h-7 text-sm"
                              placeholder="0"
                            />
                            <span className="text-xs text-muted-foreground">
                              из {ans.test_tasks?.max_score ?? '?'} баллов
                            </span>
                          </div>
                          <Textarea
                            value={g.comment}
                            onChange={(e) => setGrades((prev) => ({
                              ...prev,
                              [ans.id]: { ...prev[ans.id], comment: e.target.value }
                            }))}
                            placeholder="Комментарий к ответу (необязательно)"
                            rows={2}
                            className="text-xs resize-none"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Teacher comment + finalize */}
            {needsGrading && (
              <div className="space-y-3 border-t pt-4">
                <Textarea
                  value={teacherComment}
                  onChange={(e) => setTeacherComment(e.target.value)}
                  placeholder="Общий комментарий к попытке (необязательно)"
                  rows={2}
                  className="text-sm resize-none"
                />
                {saveError && <p className="text-xs text-destructive">{saveError}</p>}
                <Button
                  className="w-full"
                  onClick={handleFinalize}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Сохранение...</>
                  ) : (
                    manualAnswers.length > 0 ? 'Сохранить оценки и закрыть проверку' : 'Закрыть проверку'
                  )}
                </Button>
              </div>
            )}

            {!needsGrading && attempt.teacher_comment && (
              <div className="rounded-md bg-muted p-3 text-sm">
                <span className="font-medium">Комментарий:</span> {attempt.teacher_comment}
              </div>
            )}
          </div>
        )}

        {!loading && !attempt && attemptId && (
          <div className="p-4 text-sm text-muted-foreground">Не удалось загрузить попытку.</div>
        )}
      </SheetContent>
    </Sheet>
  )
}
