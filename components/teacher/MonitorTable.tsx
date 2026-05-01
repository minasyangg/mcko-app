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
  full_name: string
  grade: string | null
  test_title: string
}

interface Props {
  initialAttempts: AttemptRow[]
}

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Не начата',
  in_progress: 'В процессе',
  submitted: 'Сдана',
  under_review: 'На проверке',
  checked: 'Проверена',
  expired: 'Истекла',
}

function StatusChip({ status }: { status: string }) {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium'
  const colors: Record<string, string> = {
    in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    submitted: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    under_review: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
    not_started: 'bg-muted text-muted-foreground',
    checked: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    expired: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',
  }
  return (
    <span className={cn(base, colors[status] ?? 'bg-muted text-muted-foreground')}>
      {STATUS_LABELS[status] ?? status}
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

export function MonitorTable({ initialAttempts }: Props) {
  const [attempts, setAttempts] = useState<AttemptRow[]>(initialAttempts)
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    const channel = supabase
      .channel('attempts-monitor')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attempts' },
        (payload) => {
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
                    }
                  : a
              )
            )
          } else if (payload.eventType === 'INSERT') {
            // New attempts won't have full join data — mark as needing refresh
            // We keep the list as-is; the teacher can manually refresh if needed
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  if (attempts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-lg font-medium">Нет активных попыток</p>
        <p className="text-sm mt-1">Когда ученики начнут тест, они появятся здесь в реальном времени.</p>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Ученик</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Класс</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Тест</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Статус</th>
              <th className="px-4 py-3 text-center font-medium text-muted-foreground">Задание</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Активность</th>
              <th className="px-4 py-3 text-center font-medium text-muted-foreground">Балл</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground"></th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((a) => (
              <tr
                key={a.id}
                className="border-b last:border-0 hover:bg-muted/30 transition-colors"
              >
                <td className="px-4 py-3 font-medium">{a.full_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{a.grade ?? '—'}</td>
                <td className="px-4 py-3 max-w-[200px] truncate" title={a.test_title}>
                  {a.test_title}
                </td>
                <td className="px-4 py-3">
                  <StatusChip status={a.status} />
                </td>
                <td className="px-4 py-3 text-center text-muted-foreground">
                  {a.current_task_number ?? '—'}
                </td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                  {formatRelative(a.last_activity_at)}
                </td>
                <td className="px-4 py-3 text-center">
                  {a.score !== null
                    ? `${a.score} / ${a.max_score ?? '?'}`
                    : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedAttemptId(a.id)}
                  >
                    Подробнее
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AttemptDrawer
        attemptId={selectedAttemptId}
        onClose={() => setSelectedAttemptId(null)}
      />
    </>
  )
}
