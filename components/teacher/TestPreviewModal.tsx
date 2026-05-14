'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight, Eye } from 'lucide-react'
import MarkdownContent from '@/components/shared/MarkdownContent'
import { TaskImageGallery } from '@/components/test-player/TaskImageGallery'
import type { TestTask } from '@/components/teacher/TestDetailClient'

interface Props {
  open: boolean
  onClose: () => void
  testTitle: string
  tasks: TestTask[]
}

const taskTypeLabel: Record<string, string> = {
  single_choice: 'Один ответ',
  multiple_choice: 'Несколько ответов',
  free_response: 'Свободный ответ',
  numeric: 'Числовой',
  matching: 'Соответствие',
  short_text: 'Краткий ответ',
  composite: 'Составной',
  manual_review: 'Развёрнутый',
}

export function TestPreviewModal({ open, onClose, testTitle, tasks }: Props) {
  const sorted = [...tasks].sort((a, b) => a.task_number - b.task_number)
  const [idx, setIdx] = useState(0)

  // Reset to first task when modal opens
  useEffect(() => { if (open) setIdx(0) }, [open])

  const task = sorted[idx]
  const total = sorted.length

  function prev() { setIdx((i) => Math.max(0, i - 1)) }
  function next() { setIdx((i) => Math.min(total - 1, i + 1)) }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-4xl h-[90vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground shrink-0" />
            <DialogTitle className="text-base truncate">{testTitle}</DialogTitle>
            <Badge variant="outline" className="ml-auto shrink-0 text-xs">Предпросмотр</Badge>
          </div>
        </DialogHeader>

        {total === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Нет заданий для предпросмотра
          </div>
        ) : (
          <>
            {/* Task nav pills */}
            <div className="px-6 py-2 border-b shrink-0 overflow-x-auto">
              <div className="flex gap-1.5">
                {sorted.map((t, i) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setIdx(i)}
                    className={[
                      'shrink-0 h-6 min-w-6 px-1.5 rounded text-xs font-mono transition-colors',
                      i === idx
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80',
                    ].join(' ')}
                  >
                    {t.task_number}
                  </button>
                ))}
              </div>
            </div>

            {/* Task content — scrollable */}
            {task && (
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                {/* Task meta */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Задание {task.task_number}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {taskTypeLabel[task.task_type] ?? task.task_type}
                  </Badge>
                  {task.max_score != null && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      {task.max_score} {task.max_score === 1 ? 'балл' : 'балла'}
                    </span>
                  )}
                </div>

                {/* Images above text */}
                {task.images && task.images.length > 0 && (
                  <TaskImageGallery images={task.images} placement="above_text" />
                )}

                {/* Task text */}
                <div className="text-base">
                  {task.prompt_html
                    ? <MarkdownContent content={task.prompt_html} />
                    : <div className="leading-relaxed whitespace-pre-wrap">{task.prompt_text}</div>
                  }
                </div>

                {/* Images below text */}
                {task.images && task.images.length > 0 && (
                  <TaskImageGallery images={task.images} placement="below_text" />
                )}

                {/* Answer format hint shown as note (no actual input) */}
                {task.answer_format_hint && (
                  <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground border">
                    <span className="font-medium">Формат ответа: </span>
                    {task.answer_format_hint}
                  </div>
                )}
              </div>
            )}

            {/* Footer navigation */}
            <div className="px-6 py-3 border-t shrink-0 flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={prev}
                disabled={idx === 0}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Назад
              </Button>

              <span className="text-xs text-muted-foreground tabular-nums">
                {idx + 1} / {total}
              </span>

              <Button
                variant="outline"
                size="sm"
                onClick={next}
                disabled={idx === total - 1}
              >
                Далее
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
