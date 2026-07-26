'use client'

import type { TestTask, TaskMediaWithUrl } from '@/types/domain'
import type { Json } from '@/types/database'
import { SingleChoice } from './AnswerInput/SingleChoice'
import { MultipleChoice } from './AnswerInput/MultipleChoice'
import { ShortText } from './AnswerInput/ShortText'
import { Numeric } from './AnswerInput/Numeric'
import { Composite } from './AnswerInput/Composite'
import { TaskImageGallery } from './TaskImageGallery'
import MarkdownContent from '@/components/shared/MarkdownContent'
import { MathText } from '@/components/shared/MathText'
import { CheckCircle2, AlertCircle } from 'lucide-react'

export interface TaskPriorFeedback {
  awardedScore: number
  teacherComment: string | null
}

interface TaskViewProps {
  task: TestTask
  answer: Json | undefined
  onChange: (answer: Json) => void
  images?: TaskMediaWithUrl[]
  disabled?: boolean
  isLocked?: boolean
  priorFeedback?: TaskPriorFeedback
}

interface TaskOption {
  id: string
  text: string
}

interface AnswerPart {
  label: string
  type: string
}

function toOptions(raw: Json): TaskOption[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const o = item as Record<string, Json | undefined>
      return { id: String(o['id'] ?? ''), text: String(o['text'] ?? '') }
    }
    return { id: '', text: '' }
  }).filter((o) => o.id)
}

function toParts(raw: Json): AnswerPart[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const o = item as Record<string, Json | undefined>
      return { label: String(o['label'] ?? ''), type: String(o['type'] ?? 'text') }
    }
    return { label: '', type: 'text' }
  }).filter((p) => p.label)
}

export function TaskView({ task, answer, onChange, images = [], disabled, isLocked, priorFeedback }: TaskViewProps) {
  const answerObj =
    answer !== null && answer !== undefined && typeof answer === 'object' && !Array.isArray(answer)
      ? (answer as Record<string, Json | undefined>)
      : {}

  function renderInput() {
    switch (task.task_type) {
      case 'single_choice': {
        const options = toOptions(task.options)
        if (options.length === 0) {
          const text = typeof answerObj['text'] === 'string' ? answerObj['text'] : ''
          return <ShortText value={text} onChange={(v) => onChange({ text: v })} hint={task.answer_format_hint ?? 'Введите ответ'} disabled={disabled} size="medium" />
        }
        const selected = typeof answerObj['selected'] === 'string' ? answerObj['selected'] : null
        return (
          <SingleChoice
            options={options}
            value={selected}
            onChange={(v) => onChange({ selected: v })}
            disabled={disabled}
          />
        )
      }

      case 'multiple_choice': {
        const options = toOptions(task.options)
        if (options.length === 0) {
          const text = typeof answerObj['text'] === 'string' ? answerObj['text'] : ''
          return <ShortText value={text} onChange={(v) => onChange({ text: v })} hint={task.answer_format_hint ?? 'Введите ответ'} disabled={disabled} size="medium" />
        }
        const selected = Array.isArray(answerObj['selected'])
          ? (answerObj['selected'] as Json[]).filter((v): v is string => typeof v === 'string')
          : []
        return (
          <MultipleChoice
            options={options}
            value={selected}
            onChange={(v) => onChange({ selected: v })}
            disabled={disabled}
          />
        )
      }

      case 'free_response':
      case 'matching': {
        const text = typeof answerObj['text'] === 'string' ? answerObj['text'] : ''
        return (
          <ShortText
            value={text}
            onChange={(v) => onChange({ text: v })}
            hint={task.answer_format_hint ?? (task.task_type === 'matching' ? 'Запишите цифры по порядку, например: 312' : 'Введите ответ')}
            disabled={disabled}
            size="medium"
          />
        )
      }

      case 'short_text': {
        const text = typeof answerObj['text'] === 'string' ? answerObj['text'] : ''
        // Use small (single-line) only if hint suggests a number/code, else medium textarea
        const isNumericHint = task.answer_format_hint
          ? /числ|цифр|число|балл|\d/.test(task.answer_format_hint.toLowerCase())
          : false
        return (
          <ShortText
            value={text}
            onChange={(v) => onChange({ text: v })}
            hint={task.answer_format_hint}
            disabled={disabled}
            size={isNumericHint ? 'small' : 'medium'}
          />
        )
      }

      case 'numeric': {
        const value = typeof answerObj['value'] === 'string' ? answerObj['value'] : ''
        return (
          <Numeric
            value={value}
            onChange={(v) => onChange({ value: v })}
            hint={task.answer_format_hint}
            disabled={disabled}
          />
        )
      }

      case 'composite': {
        const parts = toParts(task.answer_parts)
        // If no parts defined, fall back to a large text area (teacher forgot to define parts)
        if (parts.length === 0) {
          const text = typeof answerObj['text'] === 'string' ? answerObj['text'] : ''
          return (
            <ShortText
              value={text}
              onChange={(v) => onChange({ text: v })}
              hint={task.answer_format_hint ?? 'Запишите решение и ответ...'}
              disabled={disabled}
              size="large"
            />
          )
        }
        const rawParts = answerObj['parts']
        const partsValue: Record<string, string> =
          rawParts !== null && rawParts !== undefined && typeof rawParts === 'object' && !Array.isArray(rawParts)
            ? Object.fromEntries(
                Object.entries(rawParts as Record<string, Json | undefined>).map(([k, v]) => [k, String(v ?? '')])
              )
            : {}
        return (
          <Composite
            parts={parts}
            value={partsValue}
            onChange={(v) => onChange({ parts: v })}
            disabled={disabled}
          />
        )
      }

      case 'manual_review': {
        const text = typeof answerObj['text'] === 'string' ? answerObj['text'] : ''
        return (
          <ShortText
            value={text}
            onChange={(v) => onChange({ text: v })}
            hint={task.answer_format_hint ?? 'Введите развёрнутый ответ'}
            disabled={disabled}
            size="large"
          />
        )
      }

      default: {
        const text = typeof answerObj['text'] === 'string' ? answerObj['text'] : ''
        return (
          <ShortText
            value={text}
            onChange={(v) => onChange({ text: v })}
            hint={task.answer_format_hint ?? 'Введите ответ'}
            disabled={disabled}
            size="medium"
          />
        )
      }
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Задача {task.task_number}
        {task.title ? ` — ${task.title}` : ''}
      </p>

      {images.length > 0 && (
        <TaskImageGallery images={images} placement="above_text" />
      )}

      {task.prompt_html
        ? <MarkdownContent content={task.prompt_html} />
        : <div className="text-base leading-relaxed whitespace-pre-wrap">{task.prompt_text}</div>
      }

      {images.length > 0 && (
        <TaskImageGallery images={images} placement="below_text" />
      )}

      {task.max_score != null && task.max_score > 1 && (
        <p className="text-xs text-muted-foreground">
          Максимальный балл: {task.max_score}
        </p>
      )}

      {isLocked ? (
        <div className="rounded-md border border-green-300 bg-green-50 dark:bg-green-950/30 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">Задание засчитано</p>
              <p className="text-xs text-green-700 dark:text-green-400">Учитель подтвердил верный ответ. Изменить нельзя.</p>
            </div>
          </div>
          {/* комментарий бывает и к зачтённому — совет на будущее */}
          {priorFeedback?.teacherComment && (
            <div className="rounded bg-green-100/70 dark:bg-green-900/30 px-3 py-2 text-xs">
              <p className="font-medium text-green-900 dark:text-green-200 mb-0.5">Комментарий учителя:</p>
              <MathText text={priorFeedback.teacherComment} className="text-green-900 dark:text-green-100" />
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Итог прошлой попытки по этому заданию: без него ученик видит
              разблокированное задание и не понимает, что в нём не так. */}
          {priorFeedback && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-4 py-3 space-y-1.5">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                    {/* при 0 баллов не пишем «решено неверно» — задание могло
                        быть просто пропущено, а строка ответа всё равно есть */}
                    {priorFeedback.awardedScore > 0
                      ? 'Задание решено частично верно'
                      : 'Задание не зачтено'}
                  </p>
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    В прошлой попытке: {priorFeedback.awardedScore}
                    {task.max_score != null ? ` из ${task.max_score}` : ''} б. Ответ можно исправить —
                    зачтётся лучший результат.
                  </p>
                </div>
              </div>
              {priorFeedback.teacherComment && (
                <div className="rounded bg-amber-100/70 dark:bg-amber-900/30 px-3 py-2 text-xs">
                  <p className="font-medium text-amber-900 dark:text-amber-200 mb-0.5">Комментарий учителя:</p>
                  <MathText text={priorFeedback.teacherComment} className="text-amber-900 dark:text-amber-100" />
                </div>
              )}
            </div>
          )}
          <div>{renderInput()}</div>
        </>
      )}
    </div>
  )
}
