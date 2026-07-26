'use client'

import { useState, useRef } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, CheckCircle2, BookOpen, Pencil, Check, X, Plus, Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import MarkdownContent from '@/components/shared/MarkdownContent'
import { AddToTestDialog } from '@/components/teacher/AddToTestDialog'

interface Problem {
  id: string
  source_id: string | null
  source_domain: string | null
  source_url: string | null
  exam_type: string
  task_number_type: string | null
  prompt_text: string
  prompt_html: string | null
  correct_answer: unknown
  answer_source?: string | null
  solution_html: string | null
  library_code: string | null
  canonical_topic: { id: string; fipicod: string | null; name: string } | null
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
  const [expanded,    setExpanded]    = useState(false)
  const [editingAns,  setEditingAns]  = useState(false)
  const [ansInput,    setAnsInput]    = useState('')
  const [localAnswer, setLocalAnswer] = useState<unknown>(problem.correct_answer)
  const [localSource, setLocalSource] = useState<string | null>(problem.answer_source ?? null)
  const [saving,      setSaving]      = useState(false)
  const [aiGenerating, setAiGenerating] = useState(false)
  const [saveError,   setSaveError]   = useState<string | null>(null)
  const [addOpen,     setAddOpen]     = useState(false)
  const [addedTo,     setAddedTo]     = useState<string | null>(null) // тест, куда уже добавлено (метка)
  const inputRef = useRef<HTMLInputElement>(null)

  const topic     = problem.canonical_topic
  const hasAns    = !!localAnswer && answerText(localAnswer) !== ''
  const hasSol    = !!problem.solution_html
  const codeLabel = problem.library_code ?? (problem.source_id ? `#${problem.source_id}` : null)
  const sourceName = problem.source_domain
    ? problem.source_domain.replace(/^https?:\/\//, '').replace(/^www\./, '')
    : 'источнике'

  const startEditing = () => {
    setAnsInput(hasAns ? answerText(localAnswer) : '')
    setEditingAns(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const cancelEditing = () => {
    setEditingAns(false)
    setAnsInput('')
    setSaveError(null)
  }

  const saveAnswer = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/library/problems/${problem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correct_answer: ansInput }),
      })
      if (res.ok) {
        setLocalAnswer(ansInput.trim() === '' ? null : ansInput.trim())
        setLocalSource(ansInput.trim() === '' ? 'none' : 'manual')
        setEditingAns(false)
      } else {
        const d = await res.json().catch(() => ({}))
        setSaveError(d.error ?? 'Ошибка сохранения')
      }
    } catch {
      setSaveError('Ошибка соединения')
    } finally {
      setSaving(false)
    }
  }

  const generateAiAnswer = async () => {
    setAiGenerating(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/library/problems/${problem.id}/ai-answer`, { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        setLocalAnswer(d.correct_answer)
        setLocalSource('ai')
      } else {
        setSaveError(d.error ?? 'ИИ не смог решить задачу')
      }
    } catch {
      setSaveError('Ошибка соединения')
    } finally {
      setAiGenerating(false)
    }
  }

  return (
    <div className={cn(
      'group rounded-lg border bg-card transition-shadow',
      expanded ? 'shadow-sm' : 'hover:shadow-sm'
    )}>
      <div className="p-4 space-y-2">
        {/* Заголовок */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {/* Код задачи */}
            {codeLabel && (
              <span className="text-xs font-mono text-muted-foreground shrink-0">
                {codeLabel}
              </span>
            )}

            {/* Экзамен + тип задачи */}
            <Badge variant="secondary" className="text-xs shrink-0">
              {problem.exam_type}
              {problem.task_number_type ? ` · ${problem.task_number_type}` : ''}
            </Badge>

            {/* Тема (canonical) */}
            {topic && (
              <span className="text-xs text-muted-foreground truncate">
                {topic.fipicod ? `${topic.fipicod} · ` : ''}{topic.name}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Статус ответа */}
            <CheckCircle2
              className={cn('h-3.5 w-3.5', hasAns ? 'text-green-500' : 'text-muted-foreground/30')}
              aria-label={hasAns ? 'Есть ответ' : 'Нет ответа'}
            />
            {/* Статус решения */}
            {hasSol && (
              <BookOpen className="h-3.5 w-3.5 text-blue-400" aria-label="Есть решение" />
            )}
            {/* Ссылка на источник */}
            {problem.source_url && (
              <a
                href={problem.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
                title={`Открыть на ${sourceName}`}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>

        {/* Текст условия */}
        {expanded ? (
          <MarkdownContent content={problem.prompt_html ?? problem.prompt_text} />
        ) : (
          <div className="max-h-28 overflow-hidden relative text-sm leading-relaxed">
            <MarkdownContent content={problem.prompt_html ?? problem.prompt_text} />
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-linear-to-t from-card to-transparent pointer-events-none" />
          </div>
        )}

        {/* Ответ */}
        {editingAns ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground shrink-0">Ответ:</span>
              <Input
                ref={inputRef}
                value={ansInput}
                onChange={e => setAnsInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveAnswer(); if (e.key === 'Escape') cancelEditing() }}
                className="h-7 text-sm flex-1"
                placeholder="Введите ответ..."
                disabled={saving}
              />
              <button onClick={saveAnswer} disabled={saving}
                className="text-green-600 hover:text-green-700 disabled:opacity-50">
                <Check className="h-4 w-4" />
              </button>
              <button onClick={cancelEditing} disabled={saving}
                className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            {saveError && <p className="text-xs text-destructive">{saveError}</p>}
          </div>
        ) : hasAns ? (
          <div className="flex items-center gap-2 group">
            <p className="text-sm">
              <span className="text-muted-foreground">Ответ: </span>
              <span className="font-medium">{answerText(localAnswer)}</span>
            </p>
            {localSource === 'ai' && (
              <Badge variant="outline" className="text-[10px] h-4 px-1 gap-0.5 text-violet-600 border-violet-300 dark:text-violet-400 dark:border-violet-700" title="Ответ сгенерирован ИИ — проверьте и при необходимости исправьте">
                <Sparkles className="h-2.5 w-2.5" />
                ИИ
              </Badge>
            )}
            <button onClick={startEditing}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <button onClick={startEditing}
                className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                <Pencil className="h-3 w-3" />
                Добавить ответ
              </button>
              <button onClick={generateAiAnswer} disabled={aiGenerating}
                className="text-xs text-violet-600 dark:text-violet-400 hover:text-violet-700 transition-colors flex items-center gap-1 disabled:opacity-60"
                title="ИИ решит задачу и сохранит эталонный ответ">
                {aiGenerating
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Sparkles className="h-3 w-3" />}
                {aiGenerating ? 'ИИ решает…' : 'Ответ ИИ'}
              </button>
            </div>
            {saveError && !editingAns && <p className="text-xs text-destructive">{saveError}</p>}
          </div>
        )}

        {/* Решение (когда раскрыто) */}
        {expanded && hasSol && (
          <div className="mt-3 pt-3 border-t space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Решение</p>
            <MarkdownContent content={problem.solution_html!.replace(/style="[^"]*display\s*:\s*none[^"]*"/gi, '')} />
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

          <div className="flex items-center gap-2">
            {/* Метка «добавлено» — чтобы не добавить задачу повторно */}
            {addedTo && (
              <span
                className="inline-flex items-center gap-1 text-xs text-green-600 font-medium max-w-40 truncate"
                title={`Добавлено в «${addedTo}»`}
              >
                <Check className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">В «{addedTo}»</span>
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddOpen(true)}
              title={addedTo ? 'Добавить ещё раз / в другой тест' : 'Добавить в тест или ДЗ'}
              className={cn(
                'h-7 w-7 p-0 rounded-full transition-all',
                addedTo
                  ? 'border-green-500 text-green-600 hover:bg-green-500 hover:text-white opacity-100'
                  : 'opacity-60 group-hover:opacity-100 hover:bg-primary hover:text-primary-foreground',
              )}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <AddToTestDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        addUrl={`/api/library/problems/${problem.id}/add-to-test`}
        problemLabel={codeLabel ?? ''}
        onAdded={(title) => setAddedTo(title)}
      />
    </div>
  )
}
