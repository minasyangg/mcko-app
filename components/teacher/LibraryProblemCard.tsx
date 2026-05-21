'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, CheckCircle2, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Problem {
  id: string
  source_id: string | null
  source_domain: string | null
  source_url: string | null
  exam_type: string
  subject: string
  grade: string | null
  task_number_type: string | null
  prompt_text: string
  prompt_html: string | null
  task_type: string
  correct_answer: unknown
  grading_method: string
  default_max_score: number
  organization_id: string | null
  solution_html: string | null
  topic_id: string | null
  library_topics: { id: string; fipicod: string | null; name: string } | null
}

interface Props {
  problem: Problem
}

function answerText(answer: unknown): string {
  if (answer === null || answer === undefined) return ''
  if (typeof answer === 'string') return answer
  if (typeof answer === 'number') return String(answer)
  if (typeof answer === 'object' && !Array.isArray(answer)) {
    const o = answer as Record<string, unknown>
    if (o.text) return String(o.text)
    if (o.value) return String(o.value)
  }
  return JSON.stringify(answer)
}

export function LibraryProblemCard({ problem }: Props) {
  const [expanded, setExpanded] = useState(false)

  const topic   = problem.library_topics
  const hasAns  = !!problem.correct_answer && answerText(problem.correct_answer) !== ''
  const hasSol  = !!problem.solution_html
  const isVerif = problem.organization_id === null
  const sdamgiaUrl = problem.source_url

  return (
    <div className={cn(
      'rounded-lg border bg-card transition-shadow',
      expanded ? 'shadow-sm' : 'hover:shadow-sm'
    )}>
      <div className="p-4 space-y-2">
        {/* Заголовок */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {/* ID задачи */}
            {problem.source_id && (
              <span className="text-xs font-mono text-muted-foreground shrink-0">
                #{problem.source_id}
              </span>
            )}

            {/* Тип задачи */}
            {problem.task_number_type && (
              <Badge variant="secondary" className="text-xs shrink-0">
                {problem.task_number_type}
              </Badge>
            )}

            {/* Тема */}
            {topic && (
              <span className="text-xs text-muted-foreground truncate">
                {topic.fipicod ? `${topic.fipicod} · ` : ''}{topic.name}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Макс. балл */}
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {problem.default_max_score} б.
            </span>

            {/* Статусы */}
            {hasAns && (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" aria-label="Есть ответ" />
            )}
            {hasSol && (
              <BookOpen className="h-3.5 w-3.5 text-blue-400" aria-label="Есть решение" />
            )}

            {/* Ссылка на источник */}
            {sdamgiaUrl && (
              <a href={sdamgiaUrl} target="_blank" rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Открыть на sdamgia.ru">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>

        {/* Текст условия */}
        {expanded && problem.prompt_html ? (
          <div
            className="text-sm prose prose-sm max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: problem.prompt_html }}
          />
        ) : (
          <p className="text-sm text-foreground line-clamp-3 leading-relaxed">
            {problem.prompt_text}
          </p>
        )}

        {/* Ответ */}
        {hasAns && (
          <p className="text-sm">
            <span className="text-muted-foreground">Ответ: </span>
            <span className="font-medium">{answerText(problem.correct_answer)}</span>
          </p>
        )}

        {/* Решение (когда раскрыто) */}
        {expanded && hasSol && (
          <div className="mt-3 pt-3 border-t space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Решение</p>
            <div
              className="text-sm prose prose-sm max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: problem.solution_html! }}
            />
          </div>
        )}

        {/* Кнопки действий */}
        <div className="flex items-center justify-between pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 px-2 text-muted-foreground"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <><ChevronUp className="h-3.5 w-3.5 mr-1" />Свернуть</>
            ) : (
              <><ChevronDown className="h-3.5 w-3.5 mr-1" />Раскрыть</>
            )}
          </Button>

          <Button size="sm" className="h-7 text-xs">
            + В тест
          </Button>
        </div>
      </div>
    </div>
  )
}
