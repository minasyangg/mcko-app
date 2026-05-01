'use client'

import type { TestTask } from '@/types/domain'
import type { Json } from '@/types/database'

interface TaskNavigatorProps {
  tasks: TestTask[]
  currentIdx: number
  answers: Record<string, Json>
  onSelect: (idx: number) => void
}

function hasAnswer(answer: Json | undefined): boolean {
  if (answer === undefined || answer === null) return false
  if (typeof answer === 'object' && !Array.isArray(answer)) {
    const obj = answer as Record<string, Json | undefined>
    // single_choice / multiple_choice
    if ('selected' in obj) {
      const sel = obj['selected']
      if (Array.isArray(sel)) return sel.length > 0
      return sel !== null && sel !== undefined && sel !== ''
    }
    // short_text
    if ('text' in obj) {
      const t = obj['text']
      return typeof t === 'string' && t.trim().length > 0
    }
    // numeric
    if ('value' in obj) {
      const v = obj['value']
      return typeof v === 'string' && v.trim().length > 0
    }
    // composite
    if ('parts' in obj) {
      const parts = obj['parts']
      if (parts !== null && typeof parts === 'object' && !Array.isArray(parts)) {
        const vals = Object.values(parts as Record<string, Json | undefined>)
        return vals.some((v) => typeof v === 'string' && v.trim().length > 0)
      }
    }
  }
  return false
}

export function TaskNavigator({ tasks, currentIdx, answers, onSelect }: TaskNavigatorProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tasks.map((task, idx) => {
        const answered = hasAnswer(answers[task.id])
        const isCurrent = idx === currentIdx

        return (
          <button
            key={task.id}
            type="button"
            onClick={() => onSelect(idx)}
            title={`Задача ${task.task_number}`}
            className={[
              'flex h-8 w-8 items-center justify-center rounded-md text-xs font-medium transition-colors',
              isCurrent
                ? 'ring-2 ring-primary ring-offset-1 bg-primary text-primary-foreground'
                : answered
                ? 'bg-primary text-primary-foreground hover:bg-primary/80'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            ].join(' ')}
          >
            {task.task_number}
          </button>
        )
      })}
    </div>
  )
}
