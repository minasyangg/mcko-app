'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import Link from 'next/link'
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  Upload,
  FileText,
  ArrowLeft,
} from 'lucide-react'

interface ImportFlowProps {
  testVersionId: string
  testId: string
  testTitle: string
  existingJob: { id: string; status: string } | null
}

type DocType = 'tasks'

interface ProgressStep {
  key: string
  label: string
  done: boolean
  active: boolean
}

function getStepsForStatus(status: string): ProgressStep[] {
  const steps = [
    { key: 'upload', label: 'Загрузка файла' },
    { key: 'extract_text', label: 'Извлечение текста' },
    { key: 'extract_images', label: 'Извлечение изображений' },
    { key: 'ai_parse', label: 'Распознавание и разбор заданий' },
    { key: 'match', label: 'Сопоставление ответов' },
  ]
  return steps.map((step, i) => ({
    ...step,
    done: status === 'done' || (status === 'processing' && i < 2),
    active: status === 'processing' && i === 2,
  }))
}

function isMdFile(file: File) {
  return file.name.endsWith('.md') || file.type === 'text/markdown'
}

function isJsonFile(file: File) {
  return file.name.endsWith('.json') || file.type === 'application/json'
}

function DropZone({
  fileState,
  onFileChange,
  disabled,
}: {
  fileState: { file: File | null }
  onFileChange: (file: File | null) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (disabled) return
      setDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) onFileChange(file)
    },
    [onFileChange, disabled]
  )

  return (
    <div
      className={`relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
        dragging
          ? 'border-primary bg-primary/5'
          : fileState.file
          ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
          : 'border-muted-foreground/30 hover:border-muted-foreground/60'
      }`}
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json,application/pdf,.md,text/markdown"
        className="hidden"
        onChange={(e) => { onFileChange(e.target.files?.[0] ?? null); e.target.value = '' }}
      />

      {fileState.file ? (
        <div className="flex flex-col items-center gap-2">
          <FileText className="h-8 w-8 text-green-500" />
          <p className="text-sm font-medium text-green-700 dark:text-green-400 break-all">
            {fileState.file.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {(fileState.file.size / 1024 / 1024).toFixed(2)} МБ
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={(e) => { e.stopPropagation(); onFileChange(null) }}
          >
            Убрать
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <Upload className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Задания (JSON, MD или PDF)</p>
            <p className="text-xs text-muted-foreground mt-1">
              Перетащите файл или нажмите для выбора
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function ProgressPhase({ jobId, testId, onRetry }: { jobId: string; testId: string; onRetry: () => void }) {
  const router = useRouter()
  const [status, setStatus] = useState<string>('queued')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/parsing/jobs/${jobId}`)
      if (!res.ok) return
      const data = await res.json()
      setStatus(data.status)
      if (data.error_message) setErrorMessage(data.error_message)
      if (data.status === 'done' || data.status === 'failed') {
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    } catch { /* ignore transient errors */ }
  }, [jobId])

  useEffect(() => {
    poll()
    intervalRef.current = setInterval(poll, 3000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [poll])

  const steps = getStepsForStatus(status)
  const progressValue = status === 'done' ? 100 : status === 'failed' ? 0 : status === 'processing' ? 50 : 10

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Обработка файла</h2>
        <p className="text-sm text-muted-foreground">
          {status === 'queued' && 'Задача в очереди, ожидайте...'}
          {status === 'processing' && 'Идёт обработка...'}
          {status === 'done' && 'Обработка успешно завершена!'}
          {status === 'failed' && 'Произошла ошибка при обработке.'}
        </p>
        {/* Живой статус с сервера (например, прогресс PaddleOCR по страницам) —
            чтобы при загруженной очереди было видно, что запрос не завис,
            а реально продвигается. */}
        {status === 'processing' && errorMessage && (
          <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>
        )}
      </div>

      {status !== 'failed' && <Progress value={progressValue} className="h-2" />}

      <div className="space-y-3">
        {steps.map((step) => (
          <div key={step.key} className="flex items-center gap-3">
            {step.done
              ? <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
              : step.active
              ? <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />
              : <Circle className="h-5 w-5 text-muted-foreground/40 shrink-0" />
            }
            <span className={`text-sm ${step.done ? 'text-foreground' : step.active ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {status === 'done' && (
        <Button onClick={() => router.push(`/teacher/tests/${testId}/review`)}>
          Перейти к проверке
        </Button>
      )}

      {status === 'failed' && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 text-destructive p-3">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <p className="text-sm">{errorMessage || 'Произошла ошибка при обработке.'}</p>
          </div>
          <Button variant="outline" onClick={onRetry}>Попробовать снова</Button>
        </div>
      )}
    </div>
  )
}

export default function ImportFlow({ testVersionId, testId, testTitle, existingJob }: ImportFlowProps) {
  const [phase, setPhase] = useState<'upload' | 'processing'>(existingJob ? 'processing' : 'upload')
  const [currentJobId, setCurrentJobId] = useState<string | null>(existingJob?.id ?? null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [tasksFile, setTasksFile] = useState<{ file: File | null }>({ file: null })

  const isJson = tasksFile.file ? isJsonFile(tasksFile.file) : false
  const isMd = tasksFile.file ? isMdFile(tasksFile.file) : false

  const handleRetry = () => {
    setPhase('upload')
    setCurrentJobId(null)
    setTasksFile({ file: null })
    setUploadError(null)
  }

  const handleSubmit = async () => {
    if (!tasksFile.file) { setUploadError('Выберите файл с заданиями'); return }
    setIsSubmitting(true)
    setUploadError(null)

    try {
      const supabase = createClient()
      const file = tasksFile.file
      const ext = isMdFile(file) ? 'md' : isJsonFile(file) ? 'json' : 'pdf'
      const contentType = isMdFile(file) ? 'text/markdown' : isJsonFile(file) ? 'application/json' : 'application/pdf'
      const storagePath = `test-documents/${testVersionId}/tasks/original.${ext}`

      const { error: upErr } = await supabase.storage
        .from('test-documents')
        .upload(storagePath, file, { upsert: true, contentType })

      if (upErr) throw new Error(`Ошибка загрузки: ${upErr.message}`)

      const res = await fetch('/api/parsing/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test_version_id: testVersionId,
          uploads: [{ docType: 'tasks' as DocType, storagePath, originalFilename: file.name }],
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Ошибка запуска парсинга')
      }

      const { job_id } = await res.json()
      setCurrentJobId(job_id)
      setPhase('processing')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Неизвестная ошибка')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link href={`/teacher/tests/${testId}`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Назад к тесту
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">{testTitle}</h1>
        <p className="text-sm text-muted-foreground mt-1">Загрузка и парсинг заданий</p>
      </div>

      {phase === 'upload' && (
        <div className="space-y-6">
          <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
            <p className="text-sm font-semibold">Поддерживаемые форматы:</p>
            <div className="text-sm text-muted-foreground space-y-1">
              <p><strong>JSON (PaddleOCR)</strong> — лучшее качество. Точное сопоставление изображений, KaTeX формулы, таблицы, ответы.</p>
              <p><strong>MD (Markdown)</strong> — OCR с формулами KaTeX. Ответы и решения внутри файла.</p>
              <p><strong>PDF</strong> — стандартный формат. Текст и изображения извлекаются автоматически.</p>
            </div>
          </div>

          {(isJson || isMd) && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 p-3 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
              <p className="text-sm text-blue-700 dark:text-blue-400">
                {isJson
                  ? 'JSON-файл PaddleOCR содержит задания, ответы, решения и изображения.'
                  : 'MD-файл содержит задания, ответы и решения.'}
              </p>
            </div>
          )}

          <DropZone fileState={tasksFile} onFileChange={(f) => setTasksFile({ file: f })} />

          {uploadError && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 text-destructive p-3">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <p className="text-sm">{uploadError}</p>
            </div>
          )}

          <Button onClick={handleSubmit} disabled={isSubmitting || !tasksFile.file} size="lg">
            {isSubmitting
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Загрузка...</>
              : 'Запустить парсинг'
            }
          </Button>
        </div>
      )}

      {phase === 'processing' && currentJobId && (
        <ProgressPhase jobId={currentJobId} testId={testId} onRetry={handleRetry} />
      )}
    </div>
  )
}
