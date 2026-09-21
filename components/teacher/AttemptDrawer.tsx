'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle2, XCircle, MinusCircle, Loader2, ZoomIn, X, Lock, ChevronDown, ChevronUp, Pencil, Check, Maximize2 } from 'lucide-react'
import { MathText } from '@/components/shared/MathText'
import MarkdownContent from '@/components/shared/MarkdownContent'
import { cn } from '@/lib/utils'
import { formatAnswerJson } from '@/lib/grading/format-answer-display'
import { formatCompositeAnswerForEdit } from '@/lib/grading/multi-part-answer'
import { ImageGallery } from '@/components/shared/ImageGallery'
import type { Json } from '@/types/database'

interface AttemptDetail {
  id: string
  status: string
  score: number | null
  max_score: number | null
  started_at: string | null
  submitted_at: string | null
  checked_at: string | null
  teacher_reviewed_at: string | null
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
  /** Просмотр расшаренной попытки (assignment_shares, 087) — получатель не
   *  назначал эту работу и не должен её оценивать. Скрывает все кнопки/поля
   *  ввода баллов и комментариев, оставляя только чтение условия, ответов
   *  ученика, корректности и итогового балла. */
  readOnly?: boolean
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
        // bg-black непрозрачный (не /80) и bg-white на самой картинке — та же
        // причина, что в лайтбоксе ImageGallery: графики/схемы часто PNG с
        // прозрачным фоном, без непрозрачной подложки затемнённый оверлей
        // просвечивал сквозь прозрачные области и чёрные линии графика
        // сливались с ним в трудноразличимое пятно.
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black p-4" onClick={() => setOpen(false)}>
          <button type="button" onClick={() => setOpen(false)} className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
            <X className="h-5 w-5" />
          </button>
          <img src={src} alt={alt ?? ''} className="max-w-full max-h-[90vh] object-contain rounded shadow-2xl bg-white" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}

// Полноэкранный просмотр одного задания — крупный текст условия (без обрезки
// «раскрыть», как в карточке), все изображения условия сразу с лупой-зумом
// через ImageGallery (вместо мелких 80×60 миниатюр ImageThumb в карточке).
// Кнопка вызова — на каждой карточке ответа, см. рендер ниже.
interface FullscreenTask {
  taskNumber: number | string
  taskType: string
  promptHtml: string | null
  promptText: string
  media: MediaRow[]
}

function TaskFullscreenView({ task, onClose }: { task: FullscreenTask | null; onClose: () => void }) {
  // Escape закрывает; скролл страницы под оверлеем блокируем — тот же
  // приём, что уже в ImageGallery для её лайтбокса.
  useEffect(() => {
    if (!task) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [task, onClose])

  if (!task) return null

  return (
    // Sheet (AttemptDrawer) занимает z-50 — без явного подъёма выше этот
    // оверлей оказался бы в том же слое и либо мерцал под панелью, либо
    // конкурировал за порядок отрисовки (тот же нюанс, что уже решён для
    // лайтбокса ImageThumb/ImageGallery через z-100 в этом же файле).
    //
    // Рендерится ВНУТРИ SheetContent (см. вызов ниже, последним ребёнком),
    // не как sibling и не через портал в body — раньше было sibling'ом, и
    // Radix (react-remove-scroll/aria-hidden внутри @radix-ui/react-dialog,
    // hideOthers()) считал этот DOM-узел "снаружи" Dialog Content, из-за
    // чего SheetContent's onPointerDownOutside/hideOthers мешали клику по
    // крестику доходить до onClick (баг: крестик не закрывал модалку).
    // Будучи частью поддерева SheetContent, оверлей больше не считается
    // "снаружи" — Radix его не трогает вовсе.
    <div
      className="fixed inset-0 z-100 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-lg shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono font-semibold bg-muted px-2 py-1 rounded">
              №{task.taskNumber}
            </span>
            <span className="text-sm text-muted-foreground">{task.taskType}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Закрыть просмотр"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-6 space-y-6">
          {task.promptHtml
            ? <div className="text-base [&_p]:my-1.5"><MarkdownContent content={task.promptHtml} /></div>
            : <p className="text-base text-muted-foreground whitespace-pre-wrap">{task.promptText}</p>
          }
          {task.media.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Изображения задания</p>
              {/* Лайтбокс галереи выше и этого оверлея, и Sheet — иначе клик
                  по картинке для зума открыл бы лупу «под» текущим окном. */}
              <ImageGallery
                layout="grid"
                lightboxZIndex={110}
                images={task.media
                  .filter((m) => m.signedUrl)
                  .map((m, i) => ({
                    id: m.id,
                    signedUrl: m.signedUrl!,
                    alt: m.alt_text ?? `Изображение ${i + 1}`,
                    sort_order: m.sort_order ?? i,
                  }))}
              />
            </div>
          )}
        </div>
      </div>
    </div>
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

export function AttemptDrawer({ attemptId, onClose, onGraded, readOnly = false }: Props) {
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null)
  const [answers, setAnswers] = useState<AnswerRow[]>([])
  const [mediaByTask, setMediaByTask] = useState<Record<string, MediaRow[]>>({})
  const [solutionPhotosByTask, setSolutionPhotosByTask] = useState<Record<string, MediaRow[]>>({})
  const [correctAnswerMap, setCorrectAnswerMap] = useState<Record<string, string>>({})
  // Сырой correct_answer (Json) + grading_method — нужны отдельно от
  // отформатированной строки выше: показ идёт через formatAnswerJson, а
  // редактирование составного ответа — через formatCompositeAnswerForEdit
  // (другой формат разделителя, "а)", не "а:") и метод проверки для сохранения.
  const [answerKeyMap, setAnswerKeyMap] = useState<Record<string, { raw: Json; gradingMethod: string }>>({})
  const [editingAnswerTaskId, setEditingAnswerTaskId] = useState<string | null>(null)
  const [answerEditInput, setAnswerEditInput] = useState('')
  const [savingAnswer, setSavingAnswer] = useState(false)
  const [answerSaveError, setAnswerSaveError] = useState<string | null>(null)
  const [changedTaskIds, setChangedTaskIds] = useState<Set<string>>(new Set())
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [grades, setGrades] = useState<Record<string, GradeState>>({})
  const [teacherComment, setTeacherComment] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [editingScores, setEditingScores] = useState(false)
  const [fullscreenAnswerId, setFullscreenAnswerId] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    setEditingScores(false)
    setEditingAnswerTaskId(null)
    setAnswerEditInput('')
    setAnswerSaveError(null)
    setFullscreenAnswerId(null)
    if (!attemptId) { setAttempt(null); setAnswers([]); setMediaByTask({}); setSolutionPhotosByTask({}); setGrades({}); setCorrectAnswerMap({}); setAnswerKeyMap({}); setChangedTaskIds(new Set()); return }
    let cancelled = false
    setLoading(true); setSaveError(null)

    async function load() {
      const [attemptRes, answersRes] = await Promise.all([
        supabase.from('attempts').select(`
          id, status, score, max_score, started_at, submitted_at, checked_at,
          teacher_reviewed_at, current_task_number, teacher_comment,
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
          // Load correct answers for teacher hint (+ редактирование эталона)
          const { data: ansKeys } = await supabase
            .from('task_answer_keys')
            .select('task_id, correct_answer, grading_method')
            .in('task_id', taskIds)
          if (ansKeys && !cancelled) {
            const m: Record<string, string> = {}
            const km: Record<string, { raw: Json; gradingMethod: string }> = {}
            for (const k of ansKeys) {
              if (!k.task_id) continue
              m[k.task_id] = formatAnswerJson(k.correct_answer as Json)
              km[k.task_id] = { raw: k.correct_answer as Json, gradingMethod: k.grading_method }
            }
            setCorrectAnswerMap(m)
            setAnswerKeyMap(km)
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

          // Фото письменного решения ученика (attempt_answer_media) — тот же
          // паттерн подписи ссылок, что и task_media, но приватный бакет
          // student-solution-media и своя таблица (см. миграцию 077).
          const { data: rawSolutionMedia } = await supabase
            .from('attempt_answer_media')
            .select('id, task_id, storage_path, width_px, height_px, sort_order')
            .eq('attempt_id', attemptId!)
            .order('sort_order', { ascending: true })

          if (rawSolutionMedia && rawSolutionMedia.length > 0 && !cancelled) {
            const paths = rawSolutionMedia.map((m) => m.storage_path)
            const { data: signed } = await supabase.storage
              .from('student-solution-media')
              .createSignedUrls(paths, 3600)

            const urlMap = Object.fromEntries((signed ?? []).map((s) => [s.path, s.signedUrl]))
            const byTask: Record<string, MediaRow[]> = {}
            for (const m of rawSolutionMedia) {
              if (!m.task_id) continue
              if (!byTask[m.task_id]) byTask[m.task_id] = []
              byTask[m.task_id].push({ ...m, alt_text: null, signedUrl: urlMap[m.storage_path] ?? '' })
            }
            setSolutionPhotosByTask(byTask)
          }
        }
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [attemptId])

  // readOnly (просмотр расшаренной попытки) принудительно гасит режим
  // проверки — получатель гранта не назначал эту работу, ему нечего
  // подтверждать/выставлять, независимо от реального статуса попытки.
  const needsGrading = !readOnly && ['submitted', 'under_review'].includes(attempt?.status ?? '')
  // Авто-проверка (объективные ответы по ключу) ставит status='checked', но
  // teacher_reviewed_at не трогает — учитель ещё не смотрел работу. Раньше
  // единственный способ снять её с «На проверке» в мониторинге — зайти в
  // «Изменить баллы» и нажать «Сохранить», не поменяв ничего. Кнопка ниже
  // делает то же самое напрямую, одним кликом, без входа в режим редактирования.
  const isAutoCheckedUnreviewed = attempt?.status === 'checked' && !attempt.teacher_reviewed_at

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
      // Локально помечаем как подтверждённое сразу — иначе кнопка «Подтвердить
      // проверку» осталась бы видна до повторного открытия дровера.
      setAttempt((prev) => prev ? { ...prev, teacher_reviewed_at: new Date().toISOString() } : prev)
      onGraded?.(attemptId, resData.score ?? 0)
    } finally {
      setIsSaving(false)
    }
  }

  // «Подтвердить проверку»: намеренно НЕ переиспользует handleFinalize — тот
  // пересобирает gradeUpdates из клиентского state `grades` и всегда шлёт
  // уведомление ученику. Здесь учитель ничего не менял, answers пустой (сервер
  // пересчитает баллы из уже сохранённых в БД значений, а не из возможно
  // устаревшего клиентского state), и skip_notify гасит повторное «работа
  // проверена» — ученик уже получил его при авто-проверке.
  const handleConfirmReview = async () => {
    if (!attemptId) return
    setIsSaving(true); setSaveError(null)
    try {
      const res = await fetch(`/api/attempts/${attemptId}/grade`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [], finalize: true, skip_notify: true }),
      })
      const resData = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(resData.error ?? 'Ошибка сохранения')
        return
      }
      setAttempt((prev) => prev ? { ...prev, teacher_reviewed_at: new Date().toISOString() } : prev)
      onGraded?.(attemptId, resData.score ?? 0)
    } finally {
      setIsSaving(false)
    }
  }

  // Правка эталонного ответа задания — НЕ трогает баллы/is_correct ни этой,
  // ни чужих попыток (по решению пользователя): цель — только исправить
  // task_answer_keys.correct_answer, чтобы библиотека заданий росла с
  // правильными ответами. Составной ответ (а)/б)/… форматируется через
  // formatCompositeAnswerForEdit — НЕ formatAnswerJson, у которой другой
  // разделитель («а: 5», не «а) 5»), несовместимый при сборке обратно
  // (см. lib/grading/multi-part-answer.ts).
  const startEditingAnswer = (taskId: string) => {
    const entry = answerKeyMap[taskId]
    setAnswerEditInput(entry ? (formatCompositeAnswerForEdit(entry.raw) ?? formatAnswerJson(entry.raw)) : '')
    setEditingAnswerTaskId(taskId)
    setAnswerSaveError(null)
  }

  const cancelEditingAnswer = () => {
    setEditingAnswerTaskId(null)
    setAnswerEditInput('')
    setAnswerSaveError(null)
  }

  const saveAnswer = async (taskId: string) => {
    setSavingAnswer(true)
    setAnswerSaveError(null)
    try {
      const res = await fetch(`/api/tasks/${taskId}/answer-key`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correct_answer: answerEditInput,
          grading_method: answerKeyMap[taskId]?.gradingMethod,
        }),
      })
      const resData = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAnswerSaveError(resData.error ?? 'Ошибка сохранения')
        return
      }
      // Перечитать сохранённый эталон, а не доверять введённому тексту как
      // есть — сервер мог собрать его в другой JSON (составной {parts:...}),
      // чем то, что ввёл учитель буквально.
      const { data: fresh } = await supabase
        .from('task_answer_keys')
        .select('correct_answer, grading_method')
        .eq('task_id', taskId)
        .single()
      if (fresh) {
        setCorrectAnswerMap(prev => ({ ...prev, [taskId]: formatAnswerJson(fresh.correct_answer as Json) }))
        setAnswerKeyMap(prev => ({ ...prev, [taskId]: { raw: fresh.correct_answer as Json, gradingMethod: fresh.grading_method } }))
      }
      setEditingAnswerTaskId(null)
      setAnswerEditInput('')
    } finally {
      setSavingAnswer(false)
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
                <Badge variant={needsGrading || isAutoCheckedUnreviewed ? 'secondary' : 'outline'}>
                  {isAutoCheckedUnreviewed ? 'Проверено автоматически' : (STATUS_LABELS[attempt.status] ?? attempt.status)}
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
                          <button
                            type="button"
                            onClick={() => setFullscreenAnswerId(ans.id)}
                            className="text-muted-foreground hover:text-foreground rounded p-0.5 hover:bg-muted"
                            title="Открыть задание на весь экран"
                            aria-label="Открыть задание на весь экран"
                          >
                            <Maximize2 className="h-3.5 w-3.5" />
                          </button>
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
                          <MathText
                            text={formatAnswerJson(ans.answer_json as Json)}
                            className="font-medium wrap-break-word"
                          />
                        </div>
                        {(() => {
                          const taskId = ans.task_id ?? ''
                          const isEditingThis = editingAnswerTaskId === taskId
                          if (isEditingThis) {
                            return (
                              <div className="bg-green-50/60 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded px-2 py-1.5 space-y-1">
                                <p className="text-xs text-green-700 dark:text-green-400 mb-0.5">Правильный ответ</p>
                                <div className="flex items-center gap-1.5">
                                  <Input
                                    autoFocus
                                    value={answerEditInput}
                                    onChange={e => setAnswerEditInput(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveAnswer(taskId); if (e.key === 'Escape') cancelEditingAnswer() }}
                                    className="h-7 text-sm flex-1"
                                    placeholder="Введите ответ, для составного: а) 5; б) 12"
                                    disabled={savingAnswer}
                                  />
                                  <button onClick={() => saveAnswer(taskId)} disabled={savingAnswer}
                                    className="text-green-700 hover:text-green-800 disabled:opacity-50 shrink-0">
                                    {savingAnswer ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                  </button>
                                  <button onClick={cancelEditingAnswer} disabled={savingAnswer}
                                    className="text-muted-foreground hover:text-foreground shrink-0">
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                                {answerSaveError && <p className="text-xs text-destructive">{answerSaveError}</p>}
                              </div>
                            )
                          }
                          if (!correctAnswerMap[taskId]) return null
                          return (
                            <div className="bg-green-50/60 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded px-2 py-1.5 group/answer">
                              <p className="text-xs text-green-700 dark:text-green-400 mb-0.5 flex items-center gap-1.5">
                                Правильный ответ
                                {!readOnly && (
                                  <button onClick={() => startEditingAnswer(taskId)}
                                    className="opacity-0 group-hover/answer:opacity-100 transition-opacity text-green-700/70 hover:text-green-800 dark:text-green-400/70 dark:hover:text-green-300"
                                    title="Исправить эталонный ответ">
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                )}
                              </p>
                              <MathText
                                text={correctAnswerMap[taskId]}
                                className="font-medium text-green-800 dark:text-green-300 text-sm"
                              />
                            </div>
                          )
                        })()}
                      </div>

                      {/* Фото письменного решения ученика (черновик на бумаге) —
                          отдельно от "ответа студента" выше: это ход решения,
                          а не проверяемое значение. Через общий ImageGallery, а
                          не локальный ImageThumb: у листов А4 с почерком важно
                          листание стрелками и счётчик «1/2», иначе проверяющий
                          открывает каждый лист отдельным кликом. */}
                      {(solutionPhotosByTask[ans.task_id ?? ''] ?? []).length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Фото решения ученика</p>
                          <ImageGallery
                            images={solutionPhotosByTask[ans.task_id ?? '']
                              .filter((m) => m.signedUrl)
                              .map((m, i) => ({
                                id: m.id,
                                signedUrl: m.signedUrl!,
                                alt: `Фото решения ${i + 1}`,
                                sort_order: m.sort_order ?? i,
                              }))}
                            // Дровер — Radix Sheet со своим высоким z-index;
                            // при дефолтных z-50 лайтбокс открывался бы ПОД
                            // панелью и выглядел как «ничего не произошло»
                            lightboxZIndex={100}
                          />
                        </div>
                      )}

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
            {!readOnly && !needsGrading && attempt.status === 'checked' && (
              <div className="border-t pt-4 space-y-3">
                {!editingScores ? (
                  <>
                    {isAutoCheckedUnreviewed && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                          Проверено автоматически по ключам ответов — учитель ещё не подтверждал баллы.
                        </p>
                        {saveError && <p className="text-xs text-destructive">{saveError}</p>}
                        <Button
                          size="sm"
                          className="w-full"
                          onClick={handleConfirmReview}
                          disabled={isSaving}
                        >
                          {isSaving
                            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Подтверждение...</>
                            : 'Подтвердить проверку'
                          }
                        </Button>
                      </div>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => setEditingScores(true)}
                    >
                      Изменить баллы
                    </Button>
                  </>
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

        {/* Внутри SheetContent намеренно (не sibling/портал в body) — см.
            комментарий в TaskFullscreenView: снаружи Radix считал оверлей
            "вне" Dialog Content и мешал клику по крестику закрывать его. */}
        <TaskFullscreenView
          task={(() => {
            const ans = answers.find((a) => a.id === fullscreenAnswerId)
            if (!ans) return null
            return {
              taskNumber: ans.test_tasks?.task_number ?? '?',
              taskType: taskTypeLabel(ans.test_tasks?.task_type ?? ''),
              promptHtml: ans.test_tasks?.prompt_html ?? null,
              promptText: ans.test_tasks?.prompt_text ?? '',
              media: mediaByTask[ans.task_id ?? ''] ?? [],
            }
          })()}
          onClose={() => setFullscreenAnswerId(null)}
        />
      </SheetContent>
    </Sheet>
  )
}
