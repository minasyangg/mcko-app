'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TestTask, TaskMediaWithUrl } from '@/types/domain'
import type { Json } from '@/types/database'
import { createClient } from '@/lib/supabase/client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight, Send, Menu, X, CheckCheck, Loader2, ArrowLeft } from 'lucide-react'

import { TaskNavigator } from './TaskNavigator'
import { TaskView, type TaskPriorFeedback } from './TaskView'
import { Timer } from './Timer'
import { SaveStatus } from './SaveStatus'
import { SubmitDialog } from './SubmitDialog'

interface TestPlayerProps {
  assignmentId: string
  attemptId: string
  startedAt: string | null
  tasks: TestTask[]
  initialAnswers: Record<string, Json>
  lockedTaskIds?: string[]
  /** Итог прошлой попытки по задаче (task_id → балл + комментарий учителя) */
  priorFeedback?: Record<string, TaskPriorFeedback>
  taskMediaMap: Record<string, TaskMediaWithUrl[]>
  timeLimitSec: number | null
  testTitle: string
  subject: string | null
  examType: string | null
  backHref: string
  backLabel: string
}

const DEBOUNCE_MS = 3000
const HEARTBEAT_MS = 30_000
// Сколько заданий вперёд/назад прогревать картинками. Плеер рендерит только
// текущее задание, поэтому браузер раньше узнавал о картинке лишь в момент
// перехода — отсюда пауза и «Изображение недоступно» при слабой сети.
// Файлы крошечные (в среднем ~6 КБ), тормозит не объём, а сам круг до
// хранилища, поэтому дешевле всего прогреть их заранее.
const PRELOAD_AHEAD = 2
const PRELOAD_BEHIND = 1

export function TestPlayer({
  assignmentId,
  attemptId,
  startedAt,
  tasks,
  initialAnswers,
  lockedTaskIds = [],
  priorFeedback = {},
  taskMediaMap,
  timeLimitSec,
  testTitle,
  subject,
  examType,
  backHref,
  backLabel,
}: TestPlayerProps) {
  const lockedSet = new Set(lockedTaskIds)
  const router = useRouter()
  const supabase = createClient()

  const [currentIdx, setCurrentIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, Json>>(initialAnswers)
  const mediaMap = taskMediaMap
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [showSubmitDialog, setShowSubmitDialog] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showNavigator, setShowNavigator] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)
  // Track which tasks have a confirmed saved answer in the DB
  const [savedTaskIds, setSavedTaskIds] = useState<Set<string>>(
    () => new Set(Object.keys(initialAnswers))
  )

  // Track pending (unsaved) answer per task
  const pendingRef = useRef<Record<string, Json>>({})
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveAnswer = useCallback(
    async (taskId: string, answerJson: Json) => {
      setSaveStatus('saving')
      try {
        const res = await fetch(`/api/attempts/${attemptId}/answers`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: taskId, answer_json: answerJson }),
        })
        if (!res.ok) throw new Error('Save failed')
        delete pendingRef.current[taskId]
        setSavedTaskIds((prev) => new Set([...prev, taskId]))
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 2000)
      } catch {
        setSaveStatus('error')
      }
    },
    [attemptId]
  )

  const flushPending = useCallback(async () => {
    const entries = Object.entries(pendingRef.current)
    if (entries.length === 0) return
    await Promise.all(entries.map(([taskId, answerJson]) => saveAnswer(taskId, answerJson)))
  }, [saveAnswer])

  function handleAnswerChange(taskId: string, answerJson: Json) {
    setAnswers((prev) => ({ ...prev, [taskId]: answerJson }))
    pendingRef.current[taskId] = answerJson
    // Mark as having unsaved changes
    setSavedTaskIds((prev) => { const n = new Set(prev); n.delete(taskId); return n })

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      saveAnswer(taskId, answerJson)
    }, DEBOUNCE_MS)
  }

  async function navigateTo(idx: number) {
    if (idx === currentIdx) return
    // Flush pending before navigating
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    await flushPending()
    setCurrentIdx(idx)
    setShowNavigator(false)
  }

  // Heartbeat
  useEffect(() => {
    async function sendHeartbeat() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        await supabase.from('presence_events').insert({
          attempt_id: attemptId,
          student_id: user.id,
          event_type: 'heartbeat',
          current_task_number: tasks[currentIdx]?.task_number ?? 1,
        })
      } catch {
        // Heartbeat failure is non-critical — attempt continues
      }
    }

    const interval = setInterval(sendHeartbeat, HEARTBEAT_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, currentIdx])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [])

  async function handleSubmit() {
    setIsSubmitting(true)
    // Flush any unsaved answers first
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    await flushPending()

    try {
      const res = await fetch(`/api/attempts/${attemptId}/submit`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Submit failed')
      router.push(`/student/attempt/${assignmentId}/result`)
    } catch {
      setSaveStatus('error')
      setIsSubmitting(false)
      setShowSubmitDialog(false)
    }
  }

  function handleExpire() {
    handleSubmit()
  }

  // Выход из попытки без сдачи: попытка остаётся in_progress, ученик вернётся
  // и продолжит. Несохранённые ответы дописываем перед уходом — иначе всё, что
  // не успел записать debounce, потерялось бы молча.
  async function handleLeave() {
    setIsLeaving(true)
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    try {
      await flushPending()
    } catch {
      // не блокируем выход из-за неудачного сохранения — статус уже показан
    }
    router.push(backHref)
  }

  const currentTask = tasks[currentIdx]

  // Прогрев картинок соседних заданий. Держим URL уже загруженных в ref, чтобы
  // не создавать Image() повторно: браузер сам отдаст их из кеша, но лишние
  // объекты на длинном тесте копятся. Ошибку прогрева намеренно игнорируем —
  // это оптимизация, реальную загрузку и повторы делает <TaskImage>.
  const preloadedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const from = Math.max(0, currentIdx - PRELOAD_BEHIND)
    const to = Math.min(tasks.length - 1, currentIdx + PRELOAD_AHEAD)
    for (let i = from; i <= to; i++) {
      if (i === currentIdx) continue // текущее уже рендерится <img>
      for (const m of mediaMap[tasks[i]?.id] ?? []) {
        const url = m.signedUrl
        if (!url || preloadedRef.current.has(url)) continue
        preloadedRef.current.add(url)
        const img = new Image()
        img.decoding = 'async'
        img.src = url
      }
    }
  }, [currentIdx, tasks, mediaMap])

  const answeredCount = tasks.filter((t) => {
    const ans = answers[t.id]
    if (ans === undefined || ans === null) return false
    if (typeof ans === 'object' && !Array.isArray(ans)) {
      const obj = ans as Record<string, Json | undefined>
      if ('selected' in obj) {
        const sel = obj['selected']
        if (Array.isArray(sel)) return sel.length > 0
        return sel !== null && sel !== undefined && sel !== ''
      }
      if ('text' in obj) return typeof obj['text'] === 'string' && obj['text'].trim().length > 0
      if ('value' in obj) return typeof obj['value'] === 'string' && obj['value'].trim().length > 0
      if ('parts' in obj) {
        const parts = obj['parts']
        if (parts !== null && typeof parts === 'object' && !Array.isArray(parts)) {
          return Object.values(parts as Record<string, Json | undefined>).some(
            (v) => typeof v === 'string' && v.trim().length > 0
          )
        }
      }
    }
    return false
  }).length

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      {/* Sticky header */}
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="flex h-14 items-center gap-3 px-4">
          {/* Mobile nav toggle */}
          <button
            type="button"
            className="flex md:hidden items-center justify-center rounded-md p-1.5 hover:bg-muted"
            onClick={() => setShowNavigator((v) => !v)}
            aria-label="Навигация по задачам"
          >
            {showNavigator ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          {/* Выход к списку — как на странице результата. Подпись явная, чтобы
              не путалась с кнопкой «Назад» внизу (переход к прошлой задаче). */}
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 h-8"
            onClick={handleLeave}
            disabled={isSubmitting || isLeaving}
            title={backLabel}
          >
            {isLeaving
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <ArrowLeft className="h-3.5 w-3.5" />}
            <span className="ml-1.5 hidden lg:inline">{backLabel}</span>
          </Button>

          <div className="flex flex-1 flex-col justify-center min-w-0">
            <span className="truncate text-sm font-semibold leading-tight">{testTitle}</span>
            {(subject || examType) && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {subject && <span>{subject}</span>}
                {examType && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{examType}</Badge>}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <SaveStatus status={saveStatus} />
            {timeLimitSec !== null && (
              <Timer
                startedAt={startedAt}
                timeLimitSec={timeLimitSec}
                onExpire={handleExpire}
              />
            )}
            <Button
              size="sm"
              variant="default"
              onClick={() => setShowSubmitDialog(true)}
              disabled={isSubmitting}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />
              <span className="hidden sm:inline">Завершить</span>
            </Button>
          </div>
        </div>

        {/* Mobile task navigator */}
        {showNavigator && (
          <div className="border-t px-4 py-3 md:hidden overflow-x-auto">
            <TaskNavigator
              tasks={tasks}
              currentIdx={currentIdx}
              answers={answers}
              onSelect={navigateTo}
            />
          </div>
        )}
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop task navigator sidebar */}
        <aside className="hidden md:flex w-64 flex-col border-r overflow-y-auto">
          <div className="p-4 space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Задачи ({answeredCount}/{tasks.length})
            </p>
            <TaskNavigator
              tasks={tasks}
              currentIdx={currentIdx}
              answers={answers}
              onSelect={navigateTo}
            />
          </div>
        </aside>

        {/* Task content */}
        <main className="flex flex-1 flex-col overflow-y-auto">
          <div className="flex-1 p-4 md:p-8 max-w-2xl mx-auto w-full space-y-4">
            {currentTask && (
              <TaskView
                task={currentTask}
                answer={answers[currentTask.id]}
                onChange={(ans) => handleAnswerChange(currentTask.id, ans)}
                images={mediaMap[currentTask.id] ?? []}
                disabled={isSubmitting || lockedSet.has(currentTask.id)}
                isLocked={lockedSet.has(currentTask.id)}
                priorFeedback={priorFeedback[currentTask.id]}
              />
            )}

            {/* Save / update answer button */}
            {currentTask && !isSubmitting && (
              <div className="flex justify-end">
                {savedTaskIds.has(currentTask.id) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-green-600 border-green-300 hover:bg-green-50"
                    disabled
                  >
                    <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
                    Ответ записан
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={async () => {
                      if (debounceTimerRef.current) {
                        clearTimeout(debounceTimerRef.current)
                        debounceTimerRef.current = null
                      }
                      const taskId = currentTask.id
                      const pending = pendingRef.current[taskId] ?? answers[taskId]
                      if (pending !== undefined) {
                        await saveAnswer(taskId, pending)
                      }
                    }}
                    disabled={saveStatus === 'saving'}
                  >
                    {saveStatus === 'saving' ? (
                      <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Сохранение...</>
                    ) : (
                      <><CheckCheck className="mr-1.5 h-3.5 w-3.5" />Записать ответ</>
                    )}
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Prev / Next navigation */}
          <div className="sticky bottom-0 border-t bg-background px-4 py-3">
            <div className="flex items-center justify-between max-w-2xl mx-auto">
              <Button
                variant="outline"
                size="sm"
                disabled={currentIdx === 0 || isSubmitting}
                onClick={() => navigateTo(currentIdx - 1)}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Назад
              </Button>
              <span className="text-sm text-muted-foreground">
                {currentIdx + 1} / {tasks.length}
              </span>
              {currentIdx < tasks.length - 1 ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isSubmitting}
                  onClick={() => navigateTo(currentIdx + 1)}
                >
                  Далее
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={isSubmitting}
                  onClick={() => setShowSubmitDialog(true)}
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  Завершить
                </Button>
              )}
            </div>
          </div>
        </main>
      </div>

      <SubmitDialog
        open={showSubmitDialog}
        onClose={() => setShowSubmitDialog(false)}
        onConfirm={handleSubmit}
        answeredCount={answeredCount}
        totalCount={tasks.length}
        isSubmitting={isSubmitting}
      />
    </div>
  )
}
