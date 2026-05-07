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

interface TaskViewProps {
  task: TestTask
  answer: Json | undefined
  onChange: (answer: Json) => void
  images?: TaskMediaWithUrl[]
  disabled?: boolean
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

export function TaskView({ task, answer, onChange, images = [], disabled }: TaskViewProps) {
  const answerObj =
    answer !== null && answer !== undefined && typeof answer === 'object' && !Array.isArray(answer)
      ? (answer as Record<string, Json | undefined>)
      : {}

  function renderInput() {
    switch (task.task_type) {
      case 'single_choice': {
        const options = toOptions(task.options)
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

      default:
        return <p className="text-muted-foreground text-sm">Неизвестный тип задачи.</p>
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

      <div>{renderInput()}</div>
    </div>
  )
}
