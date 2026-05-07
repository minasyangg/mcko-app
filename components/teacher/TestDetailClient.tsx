'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  Upload,
  BarChart2,
  UserPlus,
  EyeOff,
  Eye,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TestTask {
  id: string
  task_number: number
  sort_order: number
  prompt_text: string
  task_type: string
  options: unknown
  answer_format_hint: string | null
  max_score: number | null
  review_status: string | null
  parse_confidence: number | null
  correct_answer?: string | null
  grading_method?: string | null
}

export interface TestDetailClientProps {
  testId: string
  test: {
    title: string
    subject: string | null
    grade: string | null
    exam_type: string | null
    description: string | null
    status: string
    is_active: boolean
  }
  versionId: string | null
  versionStatus: string | null
  tasks: TestTask[]
  canEdit: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const statusLabel: Record<string, string> = {
  draft: 'Черновик',
  in_review: 'На проверке',
  published: 'Опубликован',
  archived: 'Архив',
}

const statusVariant: Record<string, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  in_review: 'secondary',
  published: 'default',
  archived: 'outline',
}

const taskTypeLabel: Record<string, string> = {
  single_choice: 'Один ответ',
  multiple_choice: 'Несколько ответов',
  free_response: 'Свободный ответ',
  numeric: 'Числовой',
  matching: 'Соответствие',
}

const gradingMethodLabel: Record<string, string> = {
  exact: 'Точное совпадение',
  normalized: 'Нормализованное',
  numeric_tolerance: 'Числовое (допуск)',
  set_match: 'Совпадение набора',
  manual: 'Ручная проверка',
}

// ─── Inline Task Edit Form ─────────────────────────────────────────────────────

interface EditTaskFormProps {
  task: TestTask
  onSave: (updated: TestTask) => void
  onCancel: () => void
}

function EditTaskForm({ task, onSave, onCancel }: EditTaskFormProps) {
  const [promptText, setPromptText] = useState(task.prompt_text)
  const [taskType, setTaskType] = useState(task.task_type)
  const [maxScore, setMaxScore] = useState(String(task.max_score ?? 1))
  const [answerFormatHint, setAnswerFormatHint] = useState(task.answer_format_hint ?? '')
  const [correctAnswer, setCorrectAnswer] = useState(task.correct_answer ?? '')
  const [gradingMethod, setGradingMethod] = useState(task.grading_method ?? 'exact')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      // Update the task
      const patchRes = await fetch(`/api/tests/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt_text: promptText,
          task_type: taskType,
          max_score: Number(maxScore) || 1,
          answer_format_hint: answerFormatHint || null,
        }),
      })
      if (!patchRes.ok) {
        const d = await patchRes.json().catch(() => ({}))
        setError(d.error ?? 'Ошибка сохранения задачи')
        return
      }

      // Update or create answer key if correct_answer provided
      if (correctAnswer !== '') {
        const answerRes = await fetch(`/api/tests/tasks/${task.id}/answer`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ correct_answer: correctAnswer, grading_method: gradingMethod }),
        })
        if (!answerRes.ok) {
          const d = await answerRes.json().catch(() => ({}))
          setError(d.error ?? 'Ошибка сохранения ответа')
          return
        }
      }

      onSave({
        ...task,
        prompt_text: promptText,
        task_type: taskType,
        max_score: Number(maxScore) || 1,
        answer_format_hint: answerFormatHint || null,
        correct_answer: correctAnswer || null,
        grading_method: correctAnswer ? gradingMethod : task.grading_method,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 pt-3 border-t mt-2">
      <div className="space-y-1">
        <Label className="text-xs">Текст задачи</Label>
        <Textarea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          rows={4}
          className="text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Тип задачи</Label>
          <Select value={taskType} onValueChange={setTaskType}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(taskTypeLabel).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Макс. балл</Label>
          <Input
            value={maxScore}
            onChange={(e) => setMaxScore(e.target.value)}
            type="number"
            min={1}
            className="h-8 text-sm"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Подсказка формата ответа</Label>
        <Input
          value={answerFormatHint}
          onChange={(e) => setAnswerFormatHint(e.target.value)}
          className="h-8 text-sm"
          placeholder="Например: целое число от 1 до 100"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Правильный ответ</Label>
        <Input
          value={correctAnswer}
          onChange={(e) => setCorrectAnswer(e.target.value)}
          className="h-8 text-sm"
          placeholder="Оставьте пустым чтобы не изменять"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Метод проверки</Label>
        <Select value={gradingMethod} onValueChange={setGradingMethod}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(gradingMethodLabel).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Сохранение...' : 'Сохранить'}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>
          Отмена
        </Button>
      </div>
    </div>
  )
}

// ─── Task Card ─────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: TestTask
  canEdit: boolean
  onUpdate: (updated: TestTask) => void
  onDelete: (taskId: string) => void
}

function TaskCard({ task, canEdit, onUpdate, onDelete }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const confidenceColor =
    task.parse_confidence == null
      ? ''
      : task.parse_confidence >= 0.8
      ? 'text-green-600'
      : task.parse_confidence >= 0.5
      ? 'text-orange-500'
      : 'text-destructive'

  const confidenceLabel =
    task.parse_confidence == null
      ? null
      : task.parse_confidence >= 0.8
      ? 'Высокая уверенность'
      : task.parse_confidence >= 0.5
      ? 'Средняя уверенность'
      : 'Низкая уверенность'

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/tests/tasks/${task.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(d.error ?? 'Ошибка удаления задачи')
        return
      }
      onDelete(task.id)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-muted-foreground w-6">#{task.task_number}</span>
            <Badge variant="outline" className="text-xs">
              {taskTypeLabel[task.task_type] ?? task.task_type}
            </Badge>
            {confidenceLabel && (
              <span className={`text-xs ${confidenceColor}`}>{confidenceLabel}</span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {canEdit && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => { setEditing(!editing); setExpanded(false) }}
                  title="Редактировать"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      title="Удалить"
                      disabled={deleting}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Удалить задачу #{task.task_number}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Задача и все связанные данные (ответы, разборы) будут удалены без возможности восстановления.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Отмена</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Удалить
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => { setExpanded(!expanded); setEditing(false) }}
              title={expanded ? 'Свернуть' : 'Развернуть'}
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {/* Task text preview */}
        <p className={`mt-2 text-sm ${expanded ? '' : 'line-clamp-2'}`}>
          {task.prompt_text}
        </p>

        {/* Answer / score row */}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {task.correct_answer != null && task.correct_answer !== '' && (
            <span>Ответ: <span className="font-medium text-foreground">{task.correct_answer}</span></span>
          )}
          {task.max_score != null && (
            <span>Балл: <span className="font-medium text-foreground">{task.max_score}</span></span>
          )}
          {task.grading_method && (
            <span>Проверка: <span className="font-medium text-foreground">{gradingMethodLabel[task.grading_method] ?? task.grading_method}</span></span>
          )}
        </div>

        {/* Edit form */}
        {editing && canEdit && (
          <EditTaskForm
            task={task}
            onSave={(updated) => { onUpdate(updated); setEditing(false) }}
            onCancel={() => setEditing(false)}
          />
        )}
      </CardContent>
    </Card>
  )
}

// ─── Inline Add Task Form ──────────────────────────────────────────────────────

interface InlineTaskFormProps {
  versionId: string
  nextTaskNumber: number
  onCreated: (task: TestTask) => void
  onCancel: () => void
}

function InlineTaskForm({ versionId, nextTaskNumber, onCreated, onCancel }: InlineTaskFormProps) {
  const [taskNumber, setTaskNumber] = useState(String(nextTaskNumber))
  const [promptText, setPromptText] = useState('')
  const [taskType, setTaskType] = useState('free_response')
  const [maxScore, setMaxScore] = useState('1')
  const [answerFormatHint, setAnswerFormatHint] = useState('')
  const [correctAnswer, setCorrectAnswer] = useState('')
  const [gradingMethod, setGradingMethod] = useState('exact')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!promptText.trim()) { setError('Введите текст задачи'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/tests/versions/${versionId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_number: Number(taskNumber) || nextTaskNumber,
          prompt_text: promptText.trim(),
          task_type: taskType,
          max_score: Number(maxScore) || 1,
          answer_format_hint: answerFormatHint || null,
          correct_answer: correctAnswer || null,
          grading_method: gradingMethod,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Ошибка создания задачи')
        return
      }
      const created: TestTask = await res.json()
      onCreated(created)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-dashed border-2">
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold mb-3">Новая задача</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">№ задачи</Label>
              <Input
                value={taskNumber}
                onChange={(e) => setTaskNumber(e.target.value)}
                type="number"
                min={1}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Тип задачи</Label>
              <Select value={taskType} onValueChange={setTaskType}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(taskTypeLabel).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Текст задачи *</Label>
            <Textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={3}
              className="text-sm"
              placeholder="Введите текст задачи..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Правильный ответ</Label>
              <Input
                value={correctAnswer}
                onChange={(e) => setCorrectAnswer(e.target.value)}
                className="h-8 text-sm"
                placeholder="Необязательно"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Метод проверки</Label>
              <Select value={gradingMethod} onValueChange={setGradingMethod}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(gradingMethodLabel).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Макс. балл</Label>
              <Input
                value={maxScore}
                onChange={(e) => setMaxScore(e.target.value)}
                type="number"
                min={1}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Подсказка формата</Label>
              <Input
                value={answerFormatHint}
                onChange={(e) => setAnswerFormatHint(e.target.value)}
                className="h-8 text-sm"
                placeholder="Необязательно"
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Добавление...' : 'Добавить задачу'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={saving}>
              Отмена
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ─── Main Client Component ─────────────────────────────────────────────────────

export function TestDetailClient({
  testId,
  test: initialTest,
  versionId,
  versionStatus,
  tasks: initialTasks,
  canEdit,
}: TestDetailClientProps) {
  const router = useRouter()
  const [tasks, setTasks] = useState<TestTask[]>(initialTasks)
  const [showAddForm, setShowAddForm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [togglingActive, setTogglingActive] = useState(false)
  const [editingMeta, setEditingMeta] = useState(false)
  const [test, setTest] = useState(initialTest)

  async function handleToggleActive() {
    setTogglingActive(true)
    try {
      const res = await fetch(`/api/tests/${testId}/toggle-active`, { method: 'PATCH' })
      if (res.ok) {
        const data = await res.json()
        setTest((prev) => ({ ...prev, is_active: data.is_active }))
      }
    } finally {
      setTogglingActive(false)
    }
  }
  const [metaForm, setMetaForm] = useState({
    title: initialTest.title,
    subject: initialTest.subject ?? '',
    grade: initialTest.grade ?? '',
    exam_type: initialTest.exam_type ?? '',
    description: initialTest.description ?? '',
  })
  const [savingMeta, setSavingMeta] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)

  async function handleSaveMeta() {
    setSavingMeta(true)
    setMetaError(null)
    try {
      const res = await fetch(`/api/tests/${testId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: metaForm.title.trim() || null,
          subject: metaForm.subject.trim() || null,
          grade: metaForm.grade.trim() || null,
          exam_type: metaForm.exam_type.trim() || null,
          description: metaForm.description.trim() || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setMetaError(d.error ?? 'Ошибка сохранения')
        return
      }
      setTest({
        ...test,
        title: metaForm.title.trim() || test.title,
        subject: metaForm.subject.trim() || null,
        grade: metaForm.grade.trim() || null,
        exam_type: metaForm.exam_type.trim() || null,
        description: metaForm.description.trim() || null,
      })
      setEditingMeta(false)
      router.refresh()
    } finally {
      setSavingMeta(false)
    }
  }

  const nextTaskNumber = tasks.length > 0 ? Math.max(...tasks.map((t) => t.task_number)) + 1 : 1

  function handleTaskUpdate(updated: TestTask) {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
  }

  function handleTaskDelete(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
  }

  function handleTaskCreated(task: TestTask) {
    setTasks((prev) => [...prev, task].sort((a, b) => a.task_number - b.task_number))
    setShowAddForm(false)
  }

  async function handleDeleteTest() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/tests/${testId}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(d.error ?? 'Ошибка удаления теста')
        return
      }
      router.push('/teacher/tests')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Back */}
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href="/teacher/tests">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Назад
        </Link>
      </Button>

      {/* ── Section 1: Header ── */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0 flex-1">
            {!editingMeta ? (
              <>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-2xl font-semibold">{test.title}</h1>
                  <Badge variant={statusVariant[test.status] ?? 'secondary'}>
                    {statusLabel[test.status] ?? test.status}
                  </Badge>
                  {versionStatus && versionStatus !== test.status && (
                    <Badge variant={statusVariant[versionStatus] ?? 'secondary'} className="text-xs">
                      Версия: {statusLabel[versionStatus] ?? versionStatus}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {test.subject && <span>Предмет: {test.subject}</span>}
                  {test.grade && <span>Класс: {test.grade}</span>}
                  {test.exam_type && <span>Тип: {test.exam_type}</span>}
                </div>
                {test.description && (
                  <p className="text-sm text-muted-foreground">{test.description}</p>
                )}
              </>
            ) : (
              <div className="space-y-3 p-4 rounded-lg border bg-muted/20">
                <p className="text-sm font-medium">Редактировать тест</p>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Название *</Label>
                    <Input
                      value={metaForm.title}
                      onChange={(e) => setMetaForm((p) => ({ ...p, title: e.target.value }))}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Предмет</Label>
                      <Input
                        value={metaForm.subject}
                        onChange={(e) => setMetaForm((p) => ({ ...p, subject: e.target.value }))}
                        className="h-8 text-sm"
                        placeholder="Физика"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Класс</Label>
                      <Input
                        value={metaForm.grade}
                        onChange={(e) => setMetaForm((p) => ({ ...p, grade: e.target.value }))}
                        className="h-8 text-sm"
                        placeholder="8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Тип</Label>
                      <Input
                        value={metaForm.exam_type}
                        onChange={(e) => setMetaForm((p) => ({ ...p, exam_type: e.target.value }))}
                        className="h-8 text-sm"
                        placeholder="ВПР"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Описание</Label>
                    <Textarea
                      value={metaForm.description}
                      onChange={(e) => setMetaForm((p) => ({ ...p, description: e.target.value }))}
                      rows={2}
                      className="text-sm resize-none"
                    />
                  </div>
                </div>
                {metaError && <p className="text-sm text-destructive">{metaError}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSaveMeta} disabled={savingMeta || !metaForm.title.trim()}>
                    {savingMeta ? 'Сохранение...' : 'Сохранить'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setEditingMeta(false); setMetaError(null) }} disabled={savingMeta}>
                    Отмена
                  </Button>
                </div>
              </div>
            )}
          </div>
          {!editingMeta && (
            <Button size="sm" variant="ghost" onClick={() => setEditingMeta(true)} title="Редактировать тест">
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/teacher/tests/${testId}/import`}>
              <Upload className="h-4 w-4 mr-1.5" />
              Загрузить PDF
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/teacher/assignments/new?test=${testId}`}>
              <UserPlus className="h-4 w-4 mr-1.5" />
              Назначить
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/teacher/tests/${testId}/analytics`}>
              <BarChart2 className="h-4 w-4 mr-1.5" />
              Аналитика
            </Link>
          </Button>
          {test.status === 'published' && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleToggleActive}
              disabled={togglingActive}
              className={test.is_active ? 'text-orange-600 border-orange-300 hover:bg-orange-50' : 'text-green-600 border-green-300 hover:bg-green-50'}
            >
              {test.is_active
                ? <><EyeOff className="h-4 w-4 mr-1.5" />{togglingActive ? '...' : 'Снять с публикации'}</>
                : <><Eye className="h-4 w-4 mr-1.5" />{togglingActive ? '...' : 'Возобновить'}</>
              }
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                disabled={deleting}
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                {deleting ? 'Удаление...' : 'Удалить тест'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Удалить тест?</AlertDialogTitle>
                <AlertDialogDescription>
                  Тест <span className="font-semibold">&quot;{test.title}&quot;</span> и все его данные
                  (версии, задачи, назначения, попытки) будут удалены без возможности восстановления.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteTest}
                  disabled={deleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Удалить
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Separator />

      {/* ── Section 2: Tasks ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Задачи{tasks.length > 0 ? ` (${tasks.length})` : ''}
          </h2>
          {canEdit && !showAddForm && versionId && (
            <Button size="sm" onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Добавить задачу
            </Button>
          )}
        </div>

        {/* Published read-only notice */}
        {!canEdit && versionStatus === 'published' && (
          <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground border">
            Тест опубликован — задачи заблокированы для редактирования.
          </div>
        )}

        {/* No version state */}
        {!versionId && (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3 text-muted-foreground">
            <p>Задачи не найдены. Загрузите PDF или добавьте задачи вручную.</p>
            <Button asChild size="sm" variant="outline">
              <Link href={`/teacher/tests/${testId}/import`}>
                <Upload className="h-4 w-4 mr-1.5" />
                Загрузить PDF
              </Link>
            </Button>
          </div>
        )}

        {/* Add form */}
        {showAddForm && versionId && (
          <InlineTaskForm
            versionId={versionId}
            nextTaskNumber={nextTaskNumber}
            onCreated={handleTaskCreated}
            onCancel={() => setShowAddForm(false)}
          />
        )}

        {/* Task list */}
        {versionId && tasks.length === 0 && !showAddForm && (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3 text-muted-foreground">
            <p>Задачи не найдены. Загрузите PDF или добавьте задачи вручную.</p>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setShowAddForm(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                Добавить задачу
              </Button>
            )}
          </div>
        )}

        {tasks.length > 0 && (
          <div className="space-y-3">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                canEdit={canEdit}
                onUpdate={handleTaskUpdate}
                onDelete={handleTaskDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
