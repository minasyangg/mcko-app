'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle2, XCircle, MinusCircle, Loader2, ZoomIn, X, Lock, ChevronDown, ChevronUp } from 'lucide-react'
import { MathText } from '@/components/shared/MathText'
import MarkdownContent from '@/components/shared/MarkdownContent'
import { cn } from '@/lib/utils'
import { formatAnswerJson } from '@/lib/grading/format-answer-display'
import type { Json } from '@/types/database'

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
  is_locked: boolean
  teacher_comment: string | null
  test_tasks: {
    task_number: number
    task_type: string
    prompt_text: string
    prompt_html: string | null
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
  onGraded?: (attemptId: string, score: number) => void
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

// Count rough sentences in plain text (split by .!? followed by space/end)
function countSentences(text: string): number {
  return (text.match(/[.!?](\s|$)/g) ?? []).length || (text.length > 0 ? 1 : 0)
}

// Renders placeholder until card scrolls into view, then mounts full content.
// `eager` skips the observer — used for the first few visible cards.
function LazyAnswerCard({ children, eager }: { children: React.ReactNode; eager: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(eager)

  useEffect(() => {
    if (eager || mounted) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setMounted(true); io.disconnect() } },
      { rootMargin: '300px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [eager, mounted])

  return (
    <div ref={ref}>
      {mounted
        ? children
        : <div className="h-20 rounded-md border bg-muted/10 animate-pulse" />
      }
    </div>
  )
}

export function AttemptDrawer({ attemptId, onClose, onGraded }: Props) {
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null)
  const [answers, setAnswers] = useState<AnswerRow[]>([])
  const [mediaByTask, setMediaByTask] = useState<Record<string, MediaRow[]>>({})
  const [correctAnswerMap, setCorrectAnswerMap] = useState<Record<string, string>>({})
  const [changedTaskIds, setChangedTaskIds] = useState<Set<string>>(new Set())
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [grades, setGrades] = useState<Record<string, GradeState>>({})
  const [teacherComment, setTeacherComment] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [editingScores, setEditingScores] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    setEditingScores(false)
    if (!attemptId) { setAttempt(null); setAnswers([]); setMediaByTask({}); setGrades({}); setCorrectAnswerMap({}); setChangedTaskIds(new Set()); return }
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
          id, task_id, answer_json, awarded_score, is_correct, is_locked, teacher_comment,
          test_tasks ( task_number, task_type, prompt_text, prompt_html, max_score )
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

        // Load correct answers and previous attempt answers
        const taskIds = sorted.map((a) => a.task_id).filter(Boolean) as string[]
        if (taskIds.length > 0) {
          // Load correct answers for teacher hint
          const { data: ansKeys } = await supabase
            .from('task_answer_keys')
            .select('task_id, correct_answer')
            .in('task_id', taskIds)
          if (ansKeys && !cancelled) {
            const m: Record<string, string> = {}
            for (const k of ansKeys) {
              if (!k.task_id) continue
              m[k.task_id] = formatAnswerJson(k.correct_answer as Json)
            }
            setCorrectAnswerMap(m)
          }

          // Find previous attempt to detect changed answers
          const attemptData = (await supabase.from('attempts')
            .select('assignment_id, student_id')
            .eq('id', attemptId!).single()).data
          if (attemptData && !cancelled) {
            const { data: prevAttempts } = await supabase
              .from('attempts')
              .select('id, started_at')
              .eq('assignment_id', attemptData.assignment_id)
              .eq('student_id', attemptData.student_id)
              .in('status', ['submitted', 'checked'])
              .order('started_at', { ascending: false })
              .limit(5)

            // Find the attempt just before current one
            const prevAttemptId = prevAttempts?.find(p => p.id !== attemptId)?.id
            if (prevAttemptId) {
              const { data: prevAnswers } = await supabase
                .from('attempt_task_answers')
                .select('task_id, answer_json')
                .eq('attempt_id', prevAttemptId)
              if (prevAnswers && !cancelled) {
                const prevMap = new Map(prevAnswers.map(p => [p.task_id, JSON.stringify(p.answer_json)]))
                const changed = new Set<string>()
                for (const ans of sorted) {
                  const tid = ans.task_id ?? ''
                  const curr = JSON.stringify(ans.answer_json)
                  if (!prevMap.has(tid) || prevMap.get(tid) !== curr) changed.add(tid)
                }
                setChangedTaskIds(changed)
              }
            }
          }
        }

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
      // is_correct = «набран ПОЛНЫЙ балл», а не «балл больше нуля». От этого
      // флага зависит блокировка задания в следующих попытках: при `> 0`
      // частично верный ответ (3 из 4) запирался навсегда, и ученик не мог
      // дотянуть его до максимума — ровно то, ради чего даются попытки.
      const maxScoreByAnswerId = new Map(
        answers.map((a) => [a.id, a.test_tasks?.max_score ?? 1])
      )
      const gradeUpdates = Object.entries(grades)
        .filter(([, g]) => g.score !== '')
        .map(([answerId, g]) => {
          const score = parseFloat(g.score) || 0
          return {
            answer_id: answerId,
            awarded_score: score,
            is_correct: score >= (maxScoreByAnswerId.get(answerId) ?? 1),
            teacher_comment: g.comment || undefined,
          }
        })

      const res = await fetch(`/api/attempts/${attemptId}/grade`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: gradeUpdates,
          finalize: true,
          teacher_comment: teacherComment || undefined,
        }),
      })
      const resData = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(resData.error ?? 'Ошибка сохранения')
        return
      }
      // Update local answer scores so the UI reflects new values immediately
      if (editingScores) {
        const scoreMap = Object.fromEntries(
          gradeUpdates.map((u) => [u.answer_id, { score: u.awarded_score, is_correct: u.is_correct }])
        )
        setAnswers((prev) => prev.map((a) =>
          scoreMap[a.id]
            ? { ...a, awarded_score: scoreMap[a.id].score, is_correct: scoreMap[a.id].is_correct }
            : a
        ))
        setEditingScores(false)
      }
      onGraded?.(attemptId, resData.score ?? 0)
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
      {/* Закрытие — только крестиком: клик по фону и Escape не закрывают,
          чтобы случайно не потерять введённые при проверке баллы/комментарии */}
      <SheetContent
        side="right"
        className="w-full sm:max-w-4xl overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
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
                {answers.map((ans, idx) => {
                  const isManual = ans.test_tasks?.task_type === 'manual_review' ||
                                   ans.test_tasks?.task_type === 'composite' ||
                                   ans.test_tasks?.task_type === 'short_text'
                  const g = grades[ans.id]
                  const taskMedia = (mediaByTask[ans.task_id ?? ''] ?? [])

                  return (
                    <LazyAnswerCard key={ans.id} eager={idx < 4}>
                    <div
                      className={cn(
                        'rounded-md border p-3 space-y-2',
                        ans.is_locked && 'border-green-300 bg-green-50/40 dark:border-green-700',
                        !ans.is_locked && ans.is_correct === true && 'border-green-200 bg-green-50/30 dark:border-green-800',
                        !ans.is_locked && ans.is_correct === false && 'border-red-100 bg-red-50/20',
                        !ans.is_locked && (ans.is_correct === null && needsGrading) && 'border-orange-200 bg-orange-50/20',
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
                          {ans.is_locked && (
                            <span className="flex items-center gap-0.5 text-[10px] text-green-700 bg-green-100 dark:bg-green-900/40 dark:text-green-400 rounded px-1.5 py-0.5">
                              <Lock className="h-2.5 w-2.5" />Засчитано
                            </span>
                          )}
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

                      {/* Task text with expand toggle */}
                      {(() => {
                        const isExpanded = expandedTaskIds.has(ans.id)
                        const plainText = ans.test_tasks?.prompt_text ?? ''
                        const content = ans.test_tasks?.prompt_html || plainText
                        const hasHtml = !!ans.test_tasks?.prompt_html
                        // Show toggle only when content has more than 3 sentences
                        const long = countSentences(plainText) > 3
                        const body = hasHtml
                          ? <div className="text-xs [&_p]:my-0.5"><MarkdownContent content={content} /></div>
                          : <p className="text-xs text-muted-foreground">{content}</p>
                        return (
                          <div>
                            {long && !isExpanded
                              ? (
                                // max-height + overflow:hidden works reliably with nested HTML
                                <div style={{ maxHeight: '7rem', overflow: 'hidden', maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)' }}>
                                  {body}
                                </div>
                              )
                              : body
                            }
                            {long && (
                              <button
                                type="button"
                                onClick={() => setExpandedTaskIds(prev => {
                                  const next = new Set(prev)
                                  next.has(ans.id) ? next.delete(ans.id) : next.add(ans.id)
                                  return next
                                })}
                                className="flex items-center gap-0.5 text-[10px] text-primary hover:underline mt-1"
                              >
                                {isExpanded
                                  ? <><ChevronUp className="h-3 w-3" />Свернуть</>
                                  : <><ChevronDown className="h-3 w-3" />Раскрыть задание</>
                                }
                              </button>
                            )}
                          </div>
                        )
                      })()}

                      {/* Task images (miniatures) */}
                      {taskMedia.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {taskMedia.map((m) => m.signedUrl && (
                            <ImageThumb key={m.id} src={m.signedUrl} alt={m.alt_text} />
                          ))}
                        </div>
                      )}

                      {/* Student answer + correct answer side by side */}
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="bg-muted/50 rounded px-2 py-1.5">
                          <p className="text-xs text-muted-foreground mb-0.5">
                            Ответ студента
                            {changedTaskIds.has(ans.task_id ?? '') && (
                              <span className="ml-1.5 text-[10px] bg-blue-100 text-blue-700 rounded px-1">изменён</span>
                            )}
                          </p>
                          <span className="font-medium wrap-break-word">{formatAnswerJson(ans.answer_json as Json)}</span>
                        </div>
                        {correctAnswerMap[ans.task_id ?? ''] && (
                          <div className="bg-green-50/60 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded px-2 py-1.5">
                            <p className="text-xs text-green-700 dark:text-green-400 mb-0.5">Правильный ответ</p>
                            <MathText
                              text={correctAnswerMap[ans.task_id ?? '']}
                              className="font-medium text-green-800 dark:text-green-300 text-sm"
                            />
                          </div>
                        )}
                      </div>

                      {/* Existing teacher comment (read-only when checked) */}
                      {!needsGrading && ans.teacher_comment && (
                        <div className="rounded bg-yellow-50/60 border border-yellow-200 px-2 py-1.5 text-xs">
                          <span className="font-medium text-yellow-800 mr-1">Комментарий:</span>
                          <MathText text={ans.teacher_comment} className="text-yellow-900 inline" />
                        </div>
                      )}

                      {/* Teacher grading inputs: when reviewing OR when editing scores of a checked attempt */}
                      {(needsGrading || editingScores) && g && (
                        <div className={cn('space-y-2 pt-1 border-t', ans.is_locked && !editingScores && 'opacity-50 pointer-events-none')}>
                          {ans.is_locked && !editingScores && (
                            <p className="text-xs text-green-700 dark:text-green-400">
                              Балл засчитан в предыдущей попытке — редактирование заблокировано.
                            </p>
                          )}
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={0}
                              max={ans.test_tasks?.max_score ?? 10}
                              value={g.score}
                              onChange={(e) => setGrades((prev) => ({
                                ...prev, [ans.id]: { ...prev[ans.id], score: e.target.value }
                              }))}
                              onWheel={(e) => e.currentTarget.blur()}
                              className="w-20 h-7 text-sm"
                              placeholder="Балл"
                              disabled={ans.is_locked && !editingScores}
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
                            disabled={ans.is_locked && !editingScores}
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
                    </LazyAnswerCard>
                  )
                })}
              </div>
            </div>

            {/* Global teacher comment + finalize (during initial grading) */}
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

            {/* Edit scores for already-checked attempts */}
            {!needsGrading && attempt.status === 'checked' && (
              <div className="border-t pt-4 space-y-3">
                {!editingScores ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setEditingScores(true)}
                  >
                    Изменить баллы
                  </Button>
                ) : (
                  <>
                    {saveError && <p className="text-xs text-destructive">{saveError}</p>}
                    <div className="flex gap-2">
                      <Button
                        className="flex-1"
                        onClick={handleFinalize}
                        disabled={isSaving}
                      >
                        {isSaving
                          ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Сохранение...</>
                          : 'Сохранить баллы'
                        }
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => { setEditingScores(false); setSaveError(null) }}
                        disabled={isSaving}
                      >
                        Отмена
                      </Button>
                    </div>
                  </>
                )}
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
