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

type DocType = 'tasks' | 'answers' | 'solutions'

interface FileState {
  file: File | null
  dragging: boolean
}

interface ProgressStep {
  key: string
  label: string
  done: boolean
  active: boolean
}

function getStepsForStatus(status: string): ProgressStep[] {
  const steps = [
    { key: 'upload', label: 'Загрузка файлов' },
    { key: 'extract_text', label: 'Извлечение текста' },
    { key: 'extract_images', label: 'Извлечение изображений' },
    { key: 'ai_parse', label: 'Анализ структуры (AI)' },
    { key: 'match', label: 'Сопоставление ответов' },
  ]

  const statusOrder = ['queued', 'processing', 'done', 'failed']
  const idx = statusOrder.indexOf(status)

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

function isValidTaskFile(file: File) {
  return file.type === 'application/pdf' || isMdFile(file) || isJsonFile(file)
}

function DropZone({
  label,
  required,
  fileState,
  onFileChange,
  accept = 'application/pdf',
  disabled,
  hint,
}: {
  label: string
  required?: boolean
  fileState: FileState
  onFileChange: (file: File | null) => void
  accept?: string
  disabled?: boolean
  hint?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (disabled) return
      setDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file && (file.type === 'application/pdf' || isMdFile(file))) {
        onFileChange(file)
      }
    },
    [onFileChange, disabled]
  )

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (!disabled) setDragging(true)
  }

  const handleDragLeave = () => setDragging(false)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    onFileChange(file)
    e.target.value = ''
  }

  if (disabled) {
    return (
      <div className="relative border-2 border-dashed rounded-lg p-6 text-center opacity-40 cursor-not-allowed border-muted-foreground/20">
        <div className="flex flex-col items-center gap-2">
          <Upload className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">{label}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
        dragging
          ? 'border-primary bg-primary/5'
          : fileState.file
          ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
          : 'border-muted-foreground/30 hover:border-muted-foreground/60'
      }`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleInputChange}
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
            onClick={(e) => {
              e.stopPropagation()
              onFileChange(null)
            }}
          >
            Убрать
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Upload className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">
            {label}
            {required && <span className="text-destructive ml-1">*</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            {hint ?? 'Перетащите файл или нажмите для выбора'}
          </p>
        </div>
      )}
    </div>
  )
}

function ProgressPhase({
  jobId,
  testId,
  onRetry,
}: {
  jobId: string
  testId: string
  onRetry: () => void
}) {
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
    } catch {
      // ignore transient errors
    }
  }, [jobId])

  useEffect(() => {
    poll()
    intervalRef.current = setInterval(poll, 3000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [poll])

  const steps = getStepsForStatus(status)

  const progressValue =
    status === 'done'
      ? 100
      : status === 'failed'
      ? 0
      : status === 'processing'
      ? 50
      : 10

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Обработка PDF</h2>
        <p className="text-sm text-muted-foreground">
          {status === 'queued' && 'Задача в очереди, ожидайте...'}
          {status === 'processing' && 'Идёт обработка файлов...'}
          {status === 'done' && 'Обработка успешно завершена!'}
          {status === 'failed' && 'Произошла ошибка при обработке.'}
        </p>
      </div>

      {status !== 'failed' && (
        <Progress value={progressValue} className="h-2" />
      )}

      <div className="space-y-3">
        {steps.map((step) => (
          <div key={step.key} className="flex items-center gap-3">
            {step.done ? (
              <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
            ) : step.active ? (
              <Loader2 className="h-5 w-5 text-primary animate-spin flex-shrink-0" />
            ) : (
              <Circle className="h-5 w-5 text-muted-foreground/40 flex-shrink-0" />
            )}
            <span
              className={`text-sm ${
                step.done
                  ? 'text-foreground'
                  : step.active
                  ? 'text-primary font-medium'
                  : 'text-muted-foreground'
              }`}
            >
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
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p className="text-sm">
              {errorMessage || 'Произошла ошибка при обработке PDF.'}
            </p>
          </div>
          <Button variant="outline" onClick={onRetry}>
            Попробовать снова
          </Button>
        </div>
      )}
    </div>
  )
}

export default function ImportFlow({
  testVersionId,
  testId,
  testTitle,
  existingJob,
}: ImportFlowProps) {
  const [phase, setPhase] = useState<'upload' | 'processing'>(
    existingJob ? 'processing' : 'upload'
  )
  const [currentJobId, setCurrentJobId] = useState<string | null>(
    existingJob?.id ?? null
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [tasksFile, setTasksFile] = useState<FileState>({ file: null, dragging: false })
  const [answersFile, setAnswersFile] = useState<FileState>({ file: null, dragging: false })
  const [solutionsFile, setSolutionsFile] = useState<FileState>({ file: null, dragging: false })

  const isMdUpload = tasksFile.file ? isMdFile(tasksFile.file) : false
  const isJsonUpload = tasksFile.file ? isJsonFile(tasksFile.file) : false
  const isSelfContained = isMdUpload || isJsonUpload

  const handleRetry = () => {
    setPhase('upload')
    setCurrentJobId(null)
    setTasksFile({ file: null, dragging: false })
    setAnswersFile({ file: null, dragging: false })
    setSolutionsFile({ file: null, dragging: false })
    setUploadError(null)
  }

  const handleSubmit = async () => {
    if (!tasksFile.file) {
      setUploadError('Файл с заданиями обязателен')
      return
    }

    setIsSubmitting(true)
    setUploadError(null)

    try {
      const supabase = createClient()

      const isMd = isMdFile(tasksFile.file)
      const isJson = isJsonFile(tasksFile.file)
      const selfContained = isMd || isJson

      const filesToUpload: Array<{ file: File; docType: DocType }> = [
        { file: tasksFile.file, docType: 'tasks' },
        // MD/JSON are self-contained — no separate answers/solutions needed
        ...(!selfContained && answersFile.file ? [{ file: answersFile.file, docType: 'answers' as DocType }] : []),
        ...(!selfContained && solutionsFile.file ? [{ file: solutionsFile.file, docType: 'solutions' as DocType }] : []),
      ]

      // Step 1: Upload files to Storage (client-side)
      const uploads: Array<{ docType: DocType; storagePath: string; originalFilename: string }> = []

      for (const { file, docType } of filesToUpload) {
        const isTasksFile = docType === 'tasks'
        const ext = isTasksFile && isMd ? 'md' : isTasksFile && isJson ? 'json' : 'pdf'
        const contentType = isTasksFile && isMd ? 'text/markdown' : isTasksFile && isJson ? 'application/json' : 'application/pdf'
        const storagePath = `test-documents/${testVersionId}/${docType}/original.${ext}`

        const { error: uploadError } = await supabase.storage
          .from('test-documents')
          .upload(storagePath, file, { upsert: true, contentType })

        if (uploadError) {
          throw new Error(`Ошибка загрузки ${docType}: ${uploadError.message}`)
        }

        uploads.push({ docType, storagePath, originalFilename: file.name })
      }

      // Step 2: Trigger parsing — server creates test_documents records (bypasses RLS)
      const res = await fetch('/api/parsing/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_version_id: testVersionId, uploads }),
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
        <p className="text-sm text-muted-foreground mt-1">Загрузка PDF и парсинг заданий</p>
      </div>

      {phase === 'upload' && (
        <div className="space-y-6">
          {/* Инструкция */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
            <p className="text-sm font-semibold">Форматы загрузки:</p>
            <div className="text-sm text-muted-foreground space-y-1">
              <p><strong>JSON (PaddleOCR)</strong> — лучшее качество. Точное сопоставление изображений с заданиями по координатам, KaTeX формулы, таблицы.</p>
              <p><strong>MD (Markdown)</strong> — OCR с формулами KaTeX. Ответы и решения внутри.</p>
              <p><strong>PDF</strong> — стандартный: файл с заданиями обязателен, ответы и решения опционально.</p>
            </div>
          </div>

          {isSelfContained && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 p-3 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
              <p className="text-sm text-blue-700 dark:text-blue-400">
                {isJsonUpload
                  ? 'JSON-файл PaddleOCR содержит задания, ответы, решения и изображения — дополнительные файлы не нужны.'
                  : 'MD-файл содержит задания, ответы и решения — дополнительные файлы не нужны.'}
              </p>
            </div>
          )}

          <div>
            <h2 className="text-lg font-semibold mb-1">Загрузите файл(ы)</h2>
            <p className="text-sm text-muted-foreground">
              JSON/MD от PaddleOCR или PDF. Файл с заданиями обязателен.
            </p>
          </div>

          <div className="grid gap-4">
            <DropZone
              label="Задания (JSON, MD или PDF)"
              required
              accept="application/json,.json,application/pdf,.md,text/markdown"
              fileState={tasksFile}
              onFileChange={(f) => {
                setTasksFile({ file: f, dragging: false })
                if (f && (isMdFile(f) || isJsonFile(f))) {
                  setAnswersFile({ file: null, dragging: false })
                  setSolutionsFile({ file: null, dragging: false })
                }
              }}
              hint="JSON/MD от PaddleOCR или обычный PDF"
            />
            <DropZone
              label="Ответы (PDF)"
              fileState={answersFile}
              onFileChange={(f) => setAnswersFile({ file: f, dragging: false })}
              disabled={isSelfContained}
              hint={isSelfContained ? 'Не нужно — ответы уже в файле' : undefined}
            />
            <DropZone
              label="Решения (PDF)"
              fileState={solutionsFile}
              onFileChange={(f) => setSolutionsFile({ file: f, dragging: false })}
              disabled={isSelfContained}
              hint={isSelfContained ? 'Не нужно — решения уже в файле' : undefined}
            />
          </div>

          {uploadError && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 text-destructive p-3">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <p className="text-sm">{uploadError}</p>
            </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !tasksFile.file}
            size="lg"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Загрузка...
              </>
            ) : (
              'Запустить парсинг'
            )}
          </Button>
        </div>
      )}

      {phase === 'processing' && currentJobId && (
        <ProgressPhase
          jobId={currentJobId}
          testId={testId}
          onRetry={handleRetry}
        />
      )}
    </div>
  )
}
