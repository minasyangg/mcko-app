'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AttemptDrawer } from '@/components/teacher/AttemptDrawer'
import { cn } from '@/lib/utils'

export interface AttemptRow {
  id: string
  student_id: string
  status: string
  current_task_number: number | null
  score: number | null
  max_score: number | null
  last_activity_at: string | null
  started_at: string | null
  submitted_at: string | null
  full_name: string
  grade: string | null
  test_title: string
  attempt_number?: number
  total_attempts?: number
  max_attempts?: number
}

interface Props {
  initialAttempts: AttemptRow[]
}

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Не начата',
  in_progress: 'В процессе',
  submitted: 'Ожидает проверки',
  under_review: 'Ожидает проверки',
  checked: 'Проверено',
  completed: 'Тест завершён',
  expired: 'Истекла',
}

function StatusChip({ status, attemptNumber, maxAttempts }: { status: string; attemptNumber?: number; maxAttempts?: number }) {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium'
  const colors: Record<string, string> = {
    in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    submitted: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    under_review: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    not_started: 'bg-muted text-muted-foreground',
    checked: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    expired: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',
  }
  const showAttempt = attemptNumber && maxAttempts && maxAttempts > 1
  let label = STATUS_LABELS[status] ?? status
  if (showAttempt && status !== 'completed') {
    label += ` · попытка ${attemptNumber}`
  }
  return (
    <span className={cn(base, colors[status] ?? 'bg-muted text-muted-foreground')}>
      {status === 'in_progress' && (
        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse inline-block" />
      )}
      {label}
    </span>
  )
}

function formatRelative(iso: string | null) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}с назад`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}м назад`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}ч назад`
  return new Date(iso).toLocaleDateString('ru-RU')
}

function formatTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

type Tab = 'active' | 'review' | 'checked'

function TableView({ rows, onSelect }: { rows: AttemptRow[]; onSelect: (id: string) => void }) {
  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Нет попыток в этом разделе
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Ученик</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Класс</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Тест</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Статус</th>
            <th className="px-4 py-3 text-center font-medium text-muted-foreground">Задание</th>
            <th className="px-4 py-3 text-center font-medium text-muted-foreground">Балл</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Активность</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Начата</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3 font-medium">{a.full_name}</td>
              <td className="px-4 py-3 text-muted-foreground">{a.grade ?? '—'}</td>
              <td className="px-4 py-3 max-w-50 truncate text-muted-foreground" title={a.test_title}>
                {a.test_title}
              </td>
              <td className="px-4 py-3"><StatusChip status={a.status} attemptNumber={a.attempt_number} maxAttempts={a.max_attempts} /></td>
              <td className="px-4 py-3 text-center text-muted-foreground">
                {a.current_task_number ?? '—'}
              </td>
              <td className="px-4 py-3 text-center font-medium tabular-nums">
                {a.score !== null ? `${a.score}/${a.max_score ?? '?'}` : '—'}
              </td>
              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                {formatRelative(a.last_activity_at)}
              </td>
              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                {formatTime(a.started_at)}
              </td>
              <td className="px-4 py-3 text-right">
                <Button variant="ghost" size="sm" onClick={() => onSelect(a.id)}>
                  {['submitted', 'under_review'].includes(a.status) ? 'Проверить' : 'Подробнее'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MonitorTable({ initialAttempts }: Props) {
  const [attempts, setAttempts] = useState<AttemptRow[]>(initialAttempts)
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('active')
  const supabase = createClient()

  useEffect(() => {
    const channel = supabase
      .channel('attempts-monitor')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attempts' }, (payload) => {
        if (payload.eventType === 'UPDATE') {
          setAttempts((prev) =>
            prev.map((a) =>
              a.id === payload.new.id
                ? {
                    ...a,
                    status: payload.new.status ?? a.status,
                    current_task_number: payload.new.current_task_number ?? a.current_task_number,
                    score: payload.new.score ?? a.score,
                    max_score: payload.new.max_score ?? a.max_score,
                    last_activity_at: payload.new.last_activity_at ?? a.last_activity_at,
                    submitted_at: payload.new.submitted_at ?? a.submitted_at,
                  }
                : a
            )
          )
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const active = attempts.filter((a) => ['not_started', 'in_progress'].includes(a.status))
  const review = attempts.filter((a) => ['submitted', 'under_review'].includes(a.status))
  const checked = attempts.filter((a) => a.status === 'checked')

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'active', label: 'В процессе', count: active.length },
    { key: 'review', label: 'На проверке', count: review.length },
    { key: 'checked', label: 'Проверено', count: checked.length },
  ]

  const currentRows = tab === 'active' ? active : tab === 'review' ? review : checked

  if (attempts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-lg font-medium">Нет попыток</p>
        <p className="text-sm mt-1">Когда ученики начнут тест, они появятся здесь.</p>
      </div>
    )
  }

  return (
    <>
      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
            {t.count > 0 && (
              <span className={cn(
                'ml-2 rounded-full px-1.5 py-0.5 text-xs font-semibold',
                t.key === 'review' ? 'bg-orange-100 text-orange-700' : 'bg-muted text-muted-foreground'
              )}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="rounded-md border overflow-hidden">
        <TableView rows={currentRows} onSelect={setSelectedAttemptId} />
      </div>

      <AttemptDrawer
        attemptId={selectedAttemptId}
        onClose={() => setSelectedAttemptId(null)}
        onGraded={(id) => {
          setAttempts((prev) => prev.map((a) => a.id === id ? { ...a, status: 'checked' } : a))
          setSelectedAttemptId(null)
        }}
      />
    </>
  )
}
