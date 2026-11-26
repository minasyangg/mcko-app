'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Json } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Loader2, Send } from 'lucide-react'
import { SHEET_MAX_PHOTOS } from '@/lib/assignments/offline'
import { SaveStatus } from './SaveStatus'
import { SubmitDialog } from './SubmitDialog'
import { Timer } from './Timer'
import { SolutionPhotoUpload, type SolutionPhoto } from './SolutionPhotoUpload'
import { SheetMaterials, type SheetMaterialItem } from './SheetMaterials'

interface SheetTask { id: string; task_number: number; max_score: number }

interface Props {
  assignmentId: string
  attemptId: string
  startedAt: string | null
  tasks: SheetTask[]
  initialAnswers: Record<string, Json>
  /** Задания, уже решённые на полный балл в прошлой попытке */
  lockedTaskIds?: string[]
  materials: SheetMaterialItem[]
  sheetPhotos: SolutionPhoto[]
  timeLimitSec: number | null
  testTitle: string
  backHref: string
  backLabel: string
}

const DEBOUNCE_MS = 2000
const HEARTBEAT_MS = 30_000

function answerText(a: Json | undefined): string {
  if (a && typeof a === 'object' && !Array.isArray(a) && typeof (a as Record<string, Json>).text === 'string') {
    return (a as Record<string, string>).text
  }
  return ''
}

// Бланк ответов по PDF (tests.answer_sheet, миграция 116): условие — в файлах
// работы, ученик на одной странице вводит только ответы по номерам и может
// приложить до SHEET_MAX_PHOTOS фото решения на всю работу. Сохранение и сдача
// — те же API, что у обычного плеера (TestPlayer): /answers и /submit.
export function AnswerSheetPlayer({
  assignmentId, attemptId, startedAt, tasks, initialAnswers, lockedTaskIds = [],
  materials, sheetPhotos, timeLimitSec, testTitle, backHref, backLabel,
}: Props) {
  const router = useRouter()
  const supabase = createClient()
  const locked = new Set(lockedTaskIds)

  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(tasks.map(t => [t.id, answerText(initialAnswers[t.id])]))
  )
  const [photos, setPhotos] = useState<SolutionPhoto[]>(sheetPhotos)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [showSubmit, setShowSubmit] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)

  const pendingRef = useRef<Record<string, string>>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveOne = useCallback(async (taskId: string, text: string, keepalive = false) => {
    const res = await fetch(`/api/attempts/${attemptId}/answers`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, answer_json: { text } }),
      keepalive,
    })
    if (!res.ok) throw new Error('Save failed')
    // снимаем с очереди, только если за это время не ввели ничего нового
    if (pendingRef.current[taskId] === text) delete pendingRef.current[taskId]
  }, [attemptId])

  const flush = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    const entries = Object.entries(pendingRef.current)
    if (entries.length === 0) return
    setSaveStatus('saving')
    try {
      await Promise.all(entries.map(([id, text]) => saveOne(id, text)))
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(s => (s === 'saved' ? 'idle' : s)), 2000)
    } catch {
      setSaveStatus('error')
    }
  }, [saveOne])

  function handleChange(taskId: string, text: string) {
    setValues(prev => ({ ...prev, [taskId]: text }))
    pendingRef.current[taskId] = text
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { flush() }, DEBOUNCE_MS)
  }

  // Монитор учителя смотрит last_activity_at; фильтр по статусу — чтобы после
  // сдачи не упереться в trg_prevent_student_self_attempt_status
  useEffect(() => {
    function beat() {
      supabase.from('attempts')
        .update({ last_activity_at: new Date().toISOString() })
        .eq('id', attemptId).eq('status', 'in_progress')
        .then(() => {}, () => {})
    }
    beat()
    const t = setInterval(beat, HEARTBEAT_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId])

  // Вкладку закрыли или свернули, пока ответ ждёт debounce — дописываем с
  // keepalive, как TestPlayer, иначе последний ответ терялся бы молча
  useEffect(() => {
    function onHide() {
      for (const [id, text] of Object.entries(pendingRef.current)) {
        saveOne(id, text, true).catch(() => {})
      }
    }
    function onVisibility() { if (document.visibilityState === 'hidden') onHide() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onHide)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [saveOne])

  async function handleSubmit() {
    setIsSubmitting(true)
    // Незаполненным заданиям — пустой ответ: без строки ответа задание не
    // попадает в окно проверки, и учитель не смог бы оценить решение,
    // которое есть только на фото
    for (const t of tasks) {
      if (!locked.has(t.id) && !values[t.id]?.trim() && !answerText(initialAnswers[t.id]).trim()) {
        pendingRef.current[t.id] ??= ''
      }
    }
    await flush()
    try {
      const res = await fetch(`/api/attempts/${attemptId}/submit`, { method: 'POST' })
      if (!res.ok) throw new Error('Submit failed')
      router.push(`/student/attempt/${assignmentId}/result`)
    } catch {
      setSaveStatus('error')
      setIsSubmitting(false)
      setShowSubmit(false)
    }
  }

  async function handleLeave() {
    setIsLeaving(true)
    try { await flush() } catch { /* статус уже показан */ }
    router.push(backHref)
  }

  // Enter — к следующему ответу, как в бланке на бумаге сверху вниз
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, idx: number) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    document.querySelector<HTMLInputElement>(`input[data-sheet-idx="${idx + 1}"]`)?.focus()
  }

  const answeredCount = tasks.filter(t => locked.has(t.id) || values[t.id]?.trim()).length

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="flex h-14 items-center gap-3 px-4">
          <Button variant="outline" size="sm" className="shrink-0 h-8" onClick={handleLeave}
            disabled={isSubmitting || isLeaving} title={backLabel}>
            {isLeaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeft className="h-3.5 w-3.5" />}
            <span className="ml-1.5 hidden lg:inline">{backLabel}</span>
          </Button>
          <span className="flex-1 min-w-0 truncate text-sm font-semibold">{testTitle}</span>
          <div className="flex items-center gap-3 shrink-0">
            <SaveStatus status={saveStatus} />
            {timeLimitSec !== null && (
              <Timer startedAt={startedAt} timeLimitSec={timeLimitSec} onExpire={handleSubmit} />
            )}
            <Button size="sm" onClick={() => setShowSubmit(true)} disabled={isSubmitting}>
              <Send className="mr-1.5 h-3.5 w-3.5" />
              <span className="hidden sm:inline">Завершить</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full p-4 md:p-8 space-y-6">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Задания работы</h2>
            <SheetMaterials materials={materials} />
          </section>

          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Ответы</h2>
              <span className="text-xs text-muted-foreground tabular-nums">{answeredCount} из {tasks.length}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Решайте по файлу работы, сюда впишите только ответы. Enter — к следующему заданию.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {tasks.map((t, idx) => {
                const isLocked = locked.has(t.id)
                return (
                  <label key={t.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                    <span className="w-10 shrink-0 text-sm font-medium tabular-nums">№{t.task_number}</span>
                    <input
                      data-sheet-idx={idx}
                      className="h-9 flex-1 min-w-0 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                      value={values[t.id] ?? ''}
                      onChange={(e) => handleChange(t.id, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, idx)}
                      disabled={isSubmitting || isLocked}
                      placeholder={isLocked ? 'решено ранее' : 'ответ'}
                      autoComplete="off"
                    />
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{t.max_score} б.</span>
                  </label>
                )
              })}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Фото решения</h2>
            <SolutionPhotoUpload
              attemptId={attemptId}
              endpoint={`/api/attempts/${attemptId}/sheet-media`}
              maxPhotos={SHEET_MAX_PHOTOS}
              photos={photos}
              onChange={setPhotos}
              disabled={isSubmitting}
            />
          </section>

          <div className="flex justify-end pb-4">
            <Button onClick={() => setShowSubmit(true)} disabled={isSubmitting}>
              <Send className="mr-1.5 h-4 w-4" />
              Завершить работу
            </Button>
          </div>
        </div>
      </main>

      <SubmitDialog
        open={showSubmit}
        onClose={() => setShowSubmit(false)}
        onConfirm={handleSubmit}
        answeredCount={answeredCount}
        totalCount={tasks.length}
        isSubmitting={isSubmitting}
      />
    </div>
  )
}
