'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle2, XCircle, MinusCircle, Loader2, ZoomIn, X } from 'lucide-react'
import { MathText } from '@/components/shared/MathText'
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

interface MediaRow {
  id: string
  task_id: string | null
  storage_path: string
  width_px: number | null
  height_px: number | null
  alt_text: string | null
  sort_order: number | null
  signedUrl?: string
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

function ImageThumb({ src, alt }: { src: string; alt?: string | null }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div
        className="relative cursor-zoom-in group rounded border overflow-hidden bg-muted shrink-0"
        style={{ width: 80, height: 60 }}
        onClick={() => setOpen(true)}
      >
        <img src={src} alt={alt ?? ''} className="w-full h-full object-contain" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <ZoomIn className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
      {open && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 p-4" onClick={() => setOpen(false)}>
          <button type="button" onClick={() => setOpen(false)} className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
            <X className="h-5 w-5" />
          </button>
          <img src={src} alt={alt ?? ''} className="max-w-full max-h-[90vh] object-contain rounded shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}

interface GradeState { score: string; comment: string }

export function AttemptDrawer({ attemptId, onClose, onGraded }: Props) {
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null)
  const [answers, setAnswers] = useState<AnswerRow[]>([])
  const [mediaByTask, setMediaByTask] = useState<Record<string, MediaRow[]>>({})
  const [loading, setLoading] = useState(false)
  const [grades, setGrades] = useState<Record<string, GradeState>>({})
  const [teacherComment, setTeacherComment] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    if (!attemptId) { setAttempt(null); setAnswers([]); setMediaByTask({}); setGrades({}); return }
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

        // Initialize grades for ALL task types
        const init: Record<string, GradeState> = {}
        for (const ans of sorted) {
          init[ans.id] = {
            score: ans.awarded_score !== null ? String(ans.awarded_score) : '',
            comment: ans.teacher_comment ?? '',
          }
        }
        setGrades(init)

        // Load task media for all tasks
        const taskIds = sorted.map((a) => a.task_id).filter(Boolean) as string[]
        if (taskIds.length > 0) {
          const { data: rawMedia } = await supabase
            .from('task_media')
            .select('id, task_id, storage_path, width_px, height_px, alt_text, sort_order')
            .in('task_id', taskIds)
            .order('sort_order', { ascending: true })

          if (rawMedia && rawMedia.length > 0 && !cancelled) {
            const paths = rawMedia.map((m) => m.storage_path)
            const { data: signed } = await supabase.storage
              .from('task-media')
              .createSignedUrls(paths, 3600)

            const urlMap = Object.fromEntries((signed ?? []).map((s) => [s.path, s.signedUrl]))
            const byTask: Record<string, MediaRow[]> = {}
            for (const m of rawMedia) {
              if (!m.task_id) continue
              if (!byTask[m.task_id]) byTask[m.task_id] = []
              byTask[m.task_id].push({ ...m, signedUrl: urlMap[m.storage_path] ?? '' })
            }
            setMediaByTask(byTask)
          }
        }
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [attemptId])

  const needsGrading = ['submitted', 'under_review'].includes(attempt?.status ?? '')

  const handleFinalize = async () => {
    if (!attemptId) return
    setIsSaving(true); setSaveError(null)
    try {
      const gradeUpdates = Object.entries(grades)
        .filter(([, g]) => g.score !== '')
        .map(([answerId, g]) => ({
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

  const taskTypeLabel = (t: string) => ({
    manual_review: 'Развёрнутый', single_choice: 'Один ответ',
    multiple_choice: 'Несколько', numeric: 'Число',
    short_text: 'Краткий', composite: 'Составное',
  }[t] ?? t)

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
                      (attempt.score / attempt.max_score!) >= 0.8 ? 'text-green-600' :
                      (attempt.score / attempt.max_score!) >= 0.6 ? 'text-orange-500' : 'text-destructive'
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
              <h3 className="text-sm font-semibold">Ответы ({answers.length})</h3>
              <div className="space-y-3">
                {answers.map((ans) => {
                  const isManual = ans.test_tasks?.task_type === 'manual_review' ||
                                   ans.test_tasks?.task_type === 'composite' ||
                                   ans.test_tasks?.task_type === 'short_text'
                  const g = grades[ans.id]
                  const taskMedia = (mediaByTask[ans.task_id ?? ''] ?? [])

                  return (
                    <div
                      key={ans.id}
                      className={cn(
                        'rounded-md border p-3 space-y-2',
                        ans.is_correct === true && 'border-green-200 bg-green-50/30 dark:border-green-800',
                        ans.is_correct === false && 'border-red-100 bg-red-50/20',
                        (ans.is_correct === null && needsGrading) && 'border-orange-200 bg-orange-50/20',
                      )}
                    >
                      {/* Header */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-semibold bg-muted px-1.5 py-0.5 rounded">
                            №{ans.test_tasks?.task_number ?? '?'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {taskTypeLabel(ans.test_tasks?.task_type ?? '')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {ans.is_correct === true && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                          {ans.is_correct === false && <XCircle className="h-4 w-4 text-red-400" />}
                          {ans.is_correct === null && <MinusCircle className="h-4 w-4 text-muted-foreground" />}
                          <span className="text-xs font-medium tabular-nums text-muted-foreground">
                            {ans.awarded_score ?? '—'}/{ans.test_tasks?.max_score ?? '?'}
                          </span>
                        </div>
                      </div>

                      {/* Task text */}
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {ans.test_tasks?.prompt_text}
                      </p>

                      {/* Task images (miniatures) */}
                      {taskMedia.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {taskMedia.map((m) => m.signedUrl && (
                            <ImageThumb key={m.id} src={m.signedUrl} alt={m.alt_text} />
                          ))}
                        </div>
                      )}

                      {/* Student answer */}
                      <div className="text-sm bg-muted/50 rounded px-2 py-1.5">
                        <span className="text-xs text-muted-foreground mr-1">Ответ:</span>
                        <span className="font-medium wrap-break-word">
                          {answerToString(ans.answer_json)}
                        </span>
                      </div>

                      {/* Existing teacher comment (read-only when checked) */}
                      {!needsGrading && ans.teacher_comment && (
                        <div className="rounded bg-yellow-50/60 border border-yellow-200 px-2 py-1.5 text-xs">
                          <span className="font-medium text-yellow-800 mr-1">Комментарий:</span>
                          <MathText text={ans.teacher_comment} className="text-yellow-900 inline" />
                        </div>
                      )}

                      {/* Teacher grading inputs for ALL task types when reviewing */}
                      {needsGrading && g && (
                        <div className="space-y-2 pt-1 border-t">
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={0}
                              max={ans.test_tasks?.max_score ?? 10}
                              value={g.score}
                              onChange={(e) => setGrades((prev) => ({
                                ...prev, [ans.id]: { ...prev[ans.id], score: e.target.value }
                              }))}
                              className="w-20 h-7 text-sm"
                              placeholder="Балл"
                            />
                            <span className="text-xs text-muted-foreground">
                              из {ans.test_tasks?.max_score ?? '?'} б.
                            </span>
                          </div>
                          <Textarea
                            value={g.comment}
                            onChange={(e) => setGrades((prev) => ({
                              ...prev, [ans.id]: { ...prev[ans.id], comment: e.target.value }
                            }))}
                            placeholder="Комментарий (поддерживается LaTeX: $x^2$, $$\frac{a}{b}$$)"
                            rows={2}
                            className="text-xs resize-none"
                          />
                          {/* LaTeX preview */}
                          {g.comment.trim() && (
                            <div className="text-xs text-muted-foreground border rounded px-2 py-1">
                              <span className="font-medium">Предпросмотр: </span>
                              <MathText text={g.comment} className="inline" />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Global teacher comment + finalize */}
            {needsGrading && (
              <div className="space-y-3 border-t pt-4">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Общий комментарий к попытке</p>
                  <Textarea
                    value={teacherComment}
                    onChange={(e) => setTeacherComment(e.target.value)}
                    placeholder="Необязательно. Поддерживается LaTeX: $F = ma$"
                    rows={2}
                    className="text-sm resize-none"
                  />
                  {teacherComment.trim() && (
                    <div className="text-xs border rounded px-2 py-1 text-muted-foreground">
                      <span className="font-medium">Предпросмотр: </span>
                      <MathText text={teacherComment} className="inline" />
                    </div>
                  )}
                </div>
                {saveError && <p className="text-xs text-destructive">{saveError}</p>}
                <Button className="w-full" onClick={handleFinalize} disabled={isSaving}>
                  {isSaving ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Сохранение...</>
                  ) : 'Закрыть проверку'}
                </Button>
              </div>
            )}

            {!needsGrading && attempt.teacher_comment && (
              <div className="rounded-md bg-muted p-3 text-sm">
                <span className="font-medium">Комментарий: </span>
                <MathText text={attempt.teacher_comment} className="inline" />
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
