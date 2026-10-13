'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Printer, XCircle } from 'lucide-react'
import MarkdownContent from '@/components/shared/MarkdownContent'
import { MathText } from '@/components/shared/MathText'
import { Button } from '@/components/ui/button'
import { markdownSource } from '@/lib/tasks/prompt'
import { formatAnswerJson, formatAnswerJsonRaw } from '@/lib/grading/format-answer-display'
import type { AttemptPrintData, PrintTask } from '@/lib/attempts/print-data'
import type { Json } from '@/types/database'
import { cn } from '@/lib/utils'

// Печатная версия попытки (страница /print/attempts/[id]). Рендер условий тот
// же, что у ученика (MarkdownContent: KaTeX, таблицы, ```graph), поэтому на
// бумаге задание выглядит как на экране. После загрузки картинок сама
// открывает окно печати; панель с кнопкой на бумагу не попадает (print:hidden).

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Не начата', in_progress: 'В процессе',
  submitted: 'На проверке', under_review: 'На проверке',
  checked: 'Проверена', expired: 'Истекла',
}

const TYPE_LABELS: Record<string, string> = {
  manual_review: 'Развёрнутый', single_choice: 'Один ответ', multiple_choice: 'Несколько',
  numeric: 'Число', short_text: 'Краткий', composite: 'Составное',
}

// Время школы, а не сервера: страница рендерится и на сервере (UTC), и в
// браузере — без явного пояса даты разошлись бы
function formatDt(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
  })
}

// Варианты ответа: короткий id («1», «а») показываем как есть, длинный
// (uuid) — порядковым номером; ответы ученика и эталон — теми же метками
function optionLabels(task: PrintTask): Map<string, string> {
  return new Map(task.options.map((o, i) => [o.id, o.id.length <= 3 ? o.id : String(i + 1)]))
}

function choiceIds(json: Json | null): string[] | null {
  if (json === null || json === undefined) return null
  if (typeof json === 'string' || typeof json === 'number') return [String(json)]
  if (Array.isArray(json)) return json.flatMap((v) => choiceIds(v) ?? [])
  if (typeof json === 'object' && 'selected' in json) return choiceIds((json as Record<string, Json>)['selected'] ?? null)
  return null
}

function answerText(task: PrintTask, json: Json | null, kind: 'student' | 'key'): string {
  if (json === null || json === undefined) return '—'
  if (task.options.length > 0) {
    const ids = choiceIds(json)
    const labels = optionLabels(task)
    if (ids && ids.length > 0 && ids.every((id) => labels.has(id))) return ids.map((id) => labels.get(id)).join(', ')
  }
  // ответ ученика — свободный ввод, без авто-обёртки LaTeX (как в окне проверки)
  return kind === 'student' ? formatAnswerJsonRaw(json) : formatAnswerJson(json)
}

export function AttemptPrintView({ data }: { data: AttemptPrintData }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const printed = useRef(false)
  const [loading, setLoading] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    // Картинки контента на сайте грузятся лениво — для печати нужны все
    // сразу, иначе нижние задания уйдут на бумагу без рисунков
    const imgs = [...root.querySelectorAll('img')]
    for (const img of imgs) img.loading = 'eager'
    let done = imgs.filter((i) => i.complete).length
    const finish = () => {
      if (printed.current) return
      printed.current = true
      setLoading(null)
      // ?noprint — открыть без окна печати (проверка вёрстки)
      if (!new URLSearchParams(window.location.search).has('noprint')) window.print()
    }
    const pending = imgs.filter((i) => !i.complete)
    if (pending.length === 0) {
      void document.fonts.ready.then(finish)
      return
    }
    setLoading({ done, total: imgs.length })
    const onSettled = () => {
      done++
      setLoading({ done, total: imgs.length })
      if (done >= imgs.length) void document.fonts.ready.then(finish)
    }
    for (const img of pending) {
      img.addEventListener('load', onSettled, { once: true })
      img.addEventListener('error', onSettled, { once: true })
    }
    // битая или очень медленная картинка не должна держать печать вечно
    const timer = setTimeout(finish, 15_000)
    return () => {
      clearTimeout(timer)
      for (const img of pending) {
        img.removeEventListener('load', onSettled)
        img.removeEventListener('error', onSettled)
      }
    }
  }, [])

  const pct = data.score !== null && data.maxScore ? Math.round((data.score / data.maxScore) * 100) : null
  const status = data.status === 'checked' && !data.teacherReviewed ? 'Проверено автоматически' : (STATUS_LABELS[data.status] ?? data.status)

  return (
    <div className="bg-white text-black">
      <style>{`@page { size: A4; margin: 12mm; }`}</style>

      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b bg-white/95 px-4 py-2 backdrop-blur print:hidden">
        <Button size="sm" onClick={() => window.print()} disabled={loading !== null}>
          <Printer className="mr-1.5 h-4 w-4" /> Сохранить в PDF / печать
        </Button>
        <span className="text-xs text-gray-600">
          {loading
            ? `Загружаю картинки: ${loading.done} из ${loading.total}…`
            : 'В окне печати выберите «Сохранить как PDF».'}
        </span>
      </div>

      <div ref={rootRef} className="mx-auto max-w-[190mm] space-y-4 px-4 py-6 text-[13px] leading-snug print:max-w-none print:px-0 print:py-0">
        <header className="space-y-1 border-b pb-3">
          <h1 className="text-lg font-semibold">
            {data.studentName}{data.grade ? `, ${data.grade} класс` : ''}
          </h1>
          <p className="text-sm">{data.testTitle}</p>
          <p className="text-xs text-gray-600">
            {[
              data.score !== null ? `Итог: ${data.score} / ${data.maxScore ?? '?'}${pct !== null ? ` (${pct}%)` : ''}` : 'Итог: —',
              status,
              formatDt(data.submittedAt) && `Сдана: ${formatDt(data.submittedAt)}`,
              formatDt(data.checkedAt) && `Проверена: ${formatDt(data.checkedAt)}`,
            ].filter(Boolean).join('  ·  ')}
          </p>
        </header>

        {data.tasks.map((task) => <PrintTaskBlock key={task.id} task={task} />)}

        {data.teacherComment?.trim() && (
          <p className="border-t pt-3 text-sm">
            <span className="font-medium">Комментарий учителя: </span>
            <MathText text={data.teacherComment} />
          </p>
        )}
      </div>
    </div>
  )
}

// Картинки задания вне текста условия — там же, где их видит ученик
// (TaskImageGallery): над условием или под ним
function TaskImages({ task, placement }: { task: PrintTask; placement: 'above_text' | 'below_text' }) {
  const images = task.images.filter((img) => img.placement === placement)
  if (images.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((img) => (
        // eager — исключение из правила ленивых картинок: страница
        // существует, чтобы уйти на печать целиком
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={img.id}
          src={img.url}
          alt={img.alt ?? `Рисунок к заданию ${task.number}`}
          loading="eager"
          decoding="async"
          className="max-h-[75mm] max-w-full break-inside-avoid rounded border border-gray-200 bg-white object-contain"
        />
      ))}
    </div>
  )
}

function PrintTaskBlock({ task }: { task: PrintTask }) {
  const a = task.answer
  const labels = optionLabels(task)
  return (
    // Задание целиком от разрыва страницы не защищаем: с рисунками оно
    // часто почти в страницу, и «не рвать» оставляло полупустые листы (а
    // первое задание уезжало со страницы с шапкой). Целыми держим номер с
    // началом условия, каждый рисунок и блок ответов.
    <article className="space-y-2 rounded-md border border-gray-300 p-3">
      <div className="flex items-center justify-between gap-2 break-after-avoid">
        <div className="flex items-center gap-2">
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs font-semibold [print-color-adjust:exact]">№{task.number}</span>
          <span className="text-xs text-gray-600">{TYPE_LABELS[task.taskType] ?? task.taskType}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-medium tabular-nums">
          {a?.isCorrect === true && <CheckCircle2 className="h-4 w-4 text-green-600" />}
          {a?.isCorrect === false && <XCircle className="h-4 w-4 text-red-600" />}
          {a ? `${a.awardedScore ?? '—'}/${task.maxScore ?? '?'}` : `нет ответа · 0/${task.maxScore ?? '?'}`}
          {a?.isLocked && <span className="font-normal text-gray-500">(засчитано ранее)</span>}
        </div>
      </div>

      <TaskImages task={task} placement="above_text" />

      <div className="[&_p]:my-1 [&_img]:break-inside-avoid">
        <MarkdownContent content={markdownSource(task.promptHtml, task.promptText)} />
      </div>

      {task.options.length > 0 && (
        <ol className="space-y-0.5 pl-1">
          {task.options.map((o) => (
            <li key={o.id} className="flex gap-1.5">
              <span className="font-semibold">{labels.get(o.id)})</span>
              <MathText text={o.text} />
            </li>
          ))}
        </ol>
      )}

      <TaskImages task={task} placement="below_text" />

      <div className="grid grid-cols-2 gap-2 break-inside-avoid">
        <div className={cn(
          'rounded border px-2 py-1.5 [print-color-adjust:exact]',
          a?.isCorrect === true ? 'border-green-300 bg-green-50' : a?.isCorrect === false ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-gray-50',
        )}>
          <p className="text-[11px] text-gray-600">Ответ ученика</p>
          <MathText text={a ? answerText(task, a.answerJson, 'student') : '—'} className="font-medium wrap-break-word" />
        </div>
        <div className="rounded border border-green-300 bg-white px-2 py-1.5 [print-color-adjust:exact]">
          <p className="text-[11px] text-green-700">Правильный ответ</p>
          <MathText text={answerText(task, task.correctAnswer, 'key')} className="font-semibold text-green-800 wrap-break-word" />
        </div>
      </div>

      {a?.teacherComment && (
        <p className="text-xs">
          <span className="font-medium">Комментарий: </span>
          <MathText text={a.teacherComment} />
        </p>
      )}
    </article>
  )
}
