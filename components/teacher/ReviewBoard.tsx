'use client'

import { useState, useTransition, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Wrench,
  ImagePlus,
  Loader2,
  X,
  Clipboard,
} from 'lucide-react'

export interface TaskWithReview {
  id: string
  task_number: number
  title: string | null
  prompt_text: string
  task_type: string
  review_status: string
  parse_confidence: number | null
  max_score: number
  answer_format_hint: string | null
  correct_answer: string | null
  media: Array<{
    id: string
    signedUrl: string
    placement: string
    sort_order: number
    alt_text: string | null
  }>
}

export interface UnmatchedImageItem {
  id: string
  signedUrl: string
  source_page: number
}

export interface ParsingWarning {
  id: string
  warning_type: string
  description: string | null
  task_id: string | null
}

interface ReviewBoardProps {
  testVersionId: string
  testId: string
  tasks: TaskWithReview[]
  unmatchedImages: UnmatchedImageItem[]
  warnings: ParsingWarning[]
  canPublish: boolean
}

const taskTypeLabel: Record<string, string> = {
  single_choice: 'Один ответ',
  multiple_choice: 'Несколько ответов',
  short_text: 'Краткий ответ',
  numeric: 'Числовой',
  composite: 'Составное',
  manual_review: 'Развёрнутый',
}

const reviewStatusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  approved: 'default',
  needs_fix: 'destructive',
  rejected: 'outline',
}

const reviewStatusLabel: Record<string, string> = {
  pending: 'Ожидает',
  approved: 'Одобрено',
  needs_fix: 'Нужна правка',
  rejected: 'Отклонено',
}

interface MediaItem {
  id: string
  signedUrl: string
  placement: string
  sort_order: number
  alt_text: string | null
}

async function uploadImageFile(taskId: string, file: File): Promise<MediaItem | null> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`/api/tasks/${taskId}/media`, { method: 'POST', body: form })
  if (!res.ok) return null
  const data = await res.json()
  return { id: data.id, signedUrl: data.signedUrl, placement: 'above_text', sort_order: 0, alt_text: null }
}

function TaskRow({
  task,
  onStatusChange,
}: {
  task: TaskWithReview
  onStatusChange: (taskId: string, newStatus: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [media, setMedia] = useState<MediaItem[]>(task.media)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const expandedDivRef = useRef<HTMLDivElement>(null)

  const confidenceLow = task.parse_confidence !== null && task.parse_confidence < 0.7

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setUploadError('Только изображения')
      return
    }
    setUploadError(null)
    setIsUploading(true)
    try {
      const item = await uploadImageFile(task.id, file)
      if (item) {
        setMedia((prev) => [...prev, { ...item, sort_order: prev.length }])
      } else {
        setUploadError('Ошибка загрузки')
      }
    } finally {
      setIsUploading(false)
    }
  }, [task.id])

  // Auto-focus the expanded container so onPaste fires scoped to this row
  useEffect(() => {
    if (expanded) {
      setTimeout(() => expandedDivRef.current?.focus(), 30)
    }
  }, [expanded])

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) await handleFile(file)
        break
      }
    }
  }, [handleFile])

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) await handleFile(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDelete = async (mediaId: string) => {
    const res = await fetch(`/api/tasks/${task.id}/media/${mediaId}`, { method: 'DELETE' })
    if (res.ok) setMedia((prev) => prev.filter((m) => m.id !== mediaId))
  }

  const handleApprove = async () => {
    setIsUpdating(true)
    try {
      const res = await fetch(`/api/parsing/tasks/${task.id}/approve`, { method: 'POST' })
      if (res.ok) onStatusChange(task.id, 'approved')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleNeedsFix = async () => {
    setIsUpdating(true)
    try {
      const res = await fetch(`/api/parsing/tasks/${task.id}/needs-fix`, { method: 'POST' })
      if (res.ok) onStatusChange(task.id, 'needs_fix')
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <>
      <tr className="border-b hover:bg-muted/30 transition-colors">
        <td className="px-4 py-3 text-center font-mono text-sm font-medium">
          {task.task_number}
        </td>
        <td className="px-4 py-3 text-center">
          {task.parse_confidence !== null ? (
            <span
              className={`text-xs font-medium ${
                confidenceLow ? 'text-orange-500' : 'text-green-600'
              }`}
            >
              {Math.round(task.parse_confidence * 100)}%
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {taskTypeLabel[task.task_type] ?? task.task_type}
          </span>
        </td>
        <td className="px-4 py-3 max-w-xs">
          <p className="text-sm truncate" title={task.prompt_text}>
            {task.prompt_text.slice(0, 120)}
            {task.prompt_text.length > 120 && '...'}
          </p>
        </td>
        <td className="px-4 py-3">
          <span className="text-sm text-muted-foreground">
            {task.correct_answer ?? '—'}
          </span>
        </td>
        <td className="px-4 py-3">
          <Badge variant={reviewStatusVariant[task.review_status] ?? 'secondary'} className="text-xs">
            {reviewStatusLabel[task.review_status] ?? task.review_status}
          </Badge>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            {task.review_status !== 'approved' && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-green-600 hover:text-green-700 hover:bg-green-50"
                onClick={handleApprove}
                disabled={isUpdating}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Одобрить
              </Button>
            )}
            {task.review_status !== 'needs_fix' && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                onClick={handleNeedsFix}
                disabled={isUpdating}
              >
                <Wrench className="h-3.5 w-3.5 mr-1" />
                Правка
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b bg-muted/10">
          <td colSpan={7} className="px-6 py-4">
            <div
              ref={expandedDivRef}
              tabIndex={0}
              onPaste={handlePaste}
              className="space-y-4 outline-none"
            >
              {/* Task text */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Полный текст задания</p>
                <p className="text-sm whitespace-pre-wrap">{task.prompt_text}</p>
              </div>

              {/* Images */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Изображения {media.length > 0 ? `(${media.length})` : ''}
                  </p>
                  <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
                    <Clipboard className="h-3 w-3" />
                    Ctrl+V для вставки скриншота
                  </span>
                </div>

                <div className="flex flex-wrap gap-3 items-start">
                  {media
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((img) => (
                      <div key={img.id} className="relative group">
                        <img
                          src={img.signedUrl}
                          alt={img.alt_text ?? `Изображение к заданию ${task.task_number}`}
                          className="h-36 w-auto max-w-xs rounded border object-contain bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => handleDelete(img.id)}
                          className="absolute top-1 right-1 hidden group-hover:flex items-center justify-center h-5 w-5 rounded-full bg-destructive text-destructive-foreground shadow"
                          title="Удалить изображение"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}

                  {/* Upload button */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="h-36 w-28 rounded border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                    title="Нажмите для выбора файла или Ctrl+V для вставки скриншота"
                  >
                    {isUploading ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      <>
                        <ImagePlus className="h-6 w-6" />
                        <span className="text-xs text-center leading-tight px-1">
                          Выбрать<br />или вставить
                        </span>
                      </>
                    )}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileInput}
                  />
                </div>

                {uploadError && (
                  <p className="text-xs text-destructive mt-1">{uploadError}</p>
                )}
              </div>

              {/* Answer */}
              {task.correct_answer && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Правильный ответ</p>
                  <p className="text-sm font-mono bg-muted rounded px-2 py-1 inline-block">
                    {task.correct_answer}
                  </p>
                </div>
              )}

              {task.answer_format_hint && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Формат ответа</p>
                  <p className="text-sm">{task.answer_format_hint}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function UnmatchedImagesPanel({
  images,
  tasks,
}: {
  images: UnmatchedImageItem[]
  tasks: TaskWithReview[]
}) {
  const [attachingId, setAttachingId] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<Record<string, string>>({})
  const [attached, setAttached] = useState<Set<string>>(new Set())

  const handleAttach = async (imageId: string) => {
    const taskId = selectedTask[imageId]
    if (!taskId) return

    setAttachingId(imageId)
    try {
      const res = await fetch(`/api/parsing/images/${imageId}/attach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, placement: 'above_text' }),
      })
      if (res.ok) {
        setAttached((prev) => new Set([...prev, imageId]))
      }
    } finally {
      setAttachingId(null)
    }
  }

  const visibleImages = images.filter((img) => !attached.has(img.id))

  if (visibleImages.length === 0) return null

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-orange-500" />
        Нераспознанные изображения ({visibleImages.length})
      </h3>
      <p className="text-xs text-muted-foreground">
        Эти изображения не были автоматически привязаны к заданиям. Привяжите их вручную.
      </p>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {visibleImages.map((img) => (
          <div key={img.id} className="space-y-2">
            <div className="relative">
              <img
                src={img.signedUrl}
                alt={`Страница ${img.source_page}`}
                className="w-full h-40 object-contain rounded border bg-white"
              />
              <span className="absolute top-1 right-1 text-xs bg-black/60 text-white rounded px-1">
                стр. {img.source_page}
              </span>
            </div>
            <div className="flex gap-1">
              <Select
                value={selectedTask[img.id] ?? ''}
                onValueChange={(val) =>
                  setSelectedTask((prev) => ({ ...prev, [img.id]: val }))
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="Задание..." />
                </SelectTrigger>
                <SelectContent>
                  {tasks.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">
                      Задание {t.task_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={!selectedTask[img.id] || attachingId === img.id}
                onClick={() => handleAttach(img.id)}
              >
                {attachingId === img.id ? '...' : 'Привязать'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ReviewBoard({
  testVersionId,
  testId,
  tasks: initialTasks,
  unmatchedImages,
  warnings,
  canPublish: initialCanPublish,
}: ReviewBoardProps) {
  const router = useRouter()
  const [tasks, setTasks] = useState<TaskWithReview[]>(initialTasks)
  const [isPublishing, startPublishing] = useTransition()
  const [publishError, setPublishError] = useState<string | null>(null)

  const approvedCount = tasks.filter((t) => t.review_status === 'approved').length
  const canPublish =
    tasks.length > 0 &&
    tasks.every((t) => t.review_status === 'approved' || t.review_status === 'rejected')

  const handleStatusChange = (taskId: string, newStatus: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, review_status: newStatus } : t))
    )
  }

  const handlePublish = () => {
    setPublishError(null)
    startPublishing(async () => {
      const res = await fetch(`/api/tests/versions/${testVersionId}/publish`, {
        method: 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPublishError(data.error || 'Ошибка публикации')
        return
      }
      router.push(`/teacher/tests/${testId}`)
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">
            Одобрено {approvedCount} / {tasks.length}
          </span>
          <div className="h-2 w-32 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${tasks.length ? (approvedCount / tasks.length) * 100 : 0}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {publishError && (
            <span className="text-xs text-destructive">{publishError}</span>
          )}
          <Button
            onClick={handlePublish}
            disabled={!canPublish || isPublishing}
            size="sm"
          >
            {isPublishing ? 'Публикация...' : 'Опубликовать тест'}
          </Button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="border border-orange-200 bg-orange-50 dark:bg-orange-950/20 rounded-lg p-4 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-orange-700 dark:text-orange-400">
            <AlertCircle className="h-4 w-4" />
            Предупреждения парсинга ({warnings.length})
          </h3>
          <ul className="space-y-1">
            {warnings.map((w) => (
              <li key={w.id} className="text-xs text-orange-700 dark:text-orange-300">
                <span className="font-medium">[{w.warning_type}]</span>{' '}
                {w.description}
                {w.task_id && (
                  <span className="ml-1 text-orange-500">
                    (задание #{tasks.find((t) => t.id === w.task_id)?.task_number ?? '?'})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-center font-medium w-12">№</th>
              <th className="px-4 py-3 text-center font-medium w-16">Уверен.</th>
              <th className="px-4 py-3 text-left font-medium w-28">Тип</th>
              <th className="px-4 py-3 text-left font-medium">Текст</th>
              <th className="px-4 py-3 text-left font-medium w-24">Ответ</th>
              <th className="px-4 py-3 text-left font-medium w-28">Статус</th>
              <th className="px-4 py-3 w-40" />
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} onStatusChange={handleStatusChange} />
            ))}
          </tbody>
        </table>

        {tasks.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Задачи не найдены
          </div>
        )}
      </div>

      <UnmatchedImagesPanel images={unmatchedImages} tasks={tasks} />
    </div>
  )
}
