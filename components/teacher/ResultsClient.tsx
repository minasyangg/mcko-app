'use client'

import { useState, useMemo } from 'react'
import { usePagination } from '@/lib/hooks/usePagination'
import { LoadMoreControl } from '@/components/shared/LoadMoreControl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { AttemptDrawer } from '@/components/teacher/AttemptDrawer'
import { TrendingUp, ChevronDown, ChevronRight, Search, Route } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AttemptRow } from '@/lib/analytics/queries'
import { gradeLabel, gradeWithSuffix } from '@/lib/students/grade-label'

interface Props {
  rows: AttemptRow[]
  tests: string[]
  programs: string[]
}

// Цвет процента — те же пороги, что в таблице (80% / 60%)
function pctTextClass(pct: number) {
  return pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-orange-500' : 'text-destructive'
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-1 max-md:p-3">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide max-md:text-[11px] max-md:tracking-normal">{label}</p>
      <p className="text-2xl font-bold tabular-nums max-md:text-xl">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

export function ResultsClient({ rows, tests, programs }: Props) {
  const [search, setSearch] = useState('')
  const [filterTest, setFilterTest] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  // тест/ДЗ считаются с одинаковым весом; фильтр даёт прогресс по каждому типу
  const [filterKind, setFilterKind] = useState('all')
  // результаты по конкретной учебной программе (задания, привязанные к теме)
  const [filterProgram, setFilterProgram] = useState('all')
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null)
  const [updatedRows, setUpdatedRows] = useState<AttemptRow[]>(rows)

  const filtered = useMemo(() => {
    return updatedRows.filter((r) => {
      if (search && !r.studentName.toLowerCase().includes(search.toLowerCase())) return false
      if (filterTest !== 'all' && r.testTitle !== filterTest) return false
      if (filterStatus !== 'all' && r.status !== filterStatus) return false
      if (filterKind !== 'all' && r.kind !== filterKind) return false
      if (filterProgram !== 'all' && r.programTitle !== filterProgram) return false
      return true
    })
  }, [updatedRows, search, filterTest, filterStatus, filterKind, filterProgram])

  // Первый экран — 20 строк, дальше по 10 за раз («показать ещё 10»).
  // Возврат к первым 20 — при любом изменении поиска/фильтров.
  const { visible, hasMore, loadMore, total, showing } = usePagination(
    filtered, 10, 20,
    `${search}|${filterTest}|${filterStatus}|${filterKind}|${filterProgram}`,
  )

  const completed = filtered.filter((r) => r.maxScore > 0)
  const avgPct = completed.length > 0
    ? Math.round(completed.reduce((s, r) => s + r.percentage, 0) / completed.length)
    : 0
  const checkedCount = filtered.filter((r) => r.status === 'checked').length
  const pendingCount = filtered.filter((r) => r.status === 'submitted').length
  const avgScore = completed.length > 0
    ? (completed.reduce((s, r) => s + r.score, 0) / completed.length).toFixed(1)
    : '—'

  const handleGraded = async (attemptId: string) => {
    // Fetch updated score from DB immediately
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { data: attempt } = await supabase
        .from('attempts')
        .select('score, max_score')
        .eq('id', attemptId)
        .single()
      setUpdatedRows((prev) => prev.map((r) =>
        r.attemptId === attemptId
          ? { ...r, status: 'checked', score: attempt?.score ?? r.score, maxScore: attempt?.max_score ?? r.maxScore, percentage: attempt?.max_score ? Math.round(((attempt?.score ?? 0) / attempt.max_score) * 100) : r.percentage }
          : r
      ))
    } catch {
      setUpdatedRows((prev) => prev.map((r) =>
        r.attemptId === attemptId ? { ...r, status: 'checked' } : r
      ))
    }
    setSelectedAttemptId(null)
  }

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-md:gap-2">
        <StatCard label="Всего попыток" value={filtered.length} />
        <StatCard label="Средний балл" value={avgScore} sub={`${avgPct}% в среднем`} />
        <StatCard label="Проверено" value={checkedCount} sub={`${filtered.length - checkedCount} осталось`} />
        <StatCard label="На проверке" value={pendingCount} sub="ожидают учителя" />
      </div>

      {/* Filters */}
      {/* Телефон: поиск и выбор теста — во всю ширину, тип и статус — парой */}
      <div className="flex flex-wrap gap-3 items-center max-md:gap-2">
        <div className="relative flex-1 min-w-40 max-md:basis-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по ученику..."
            className="pl-8 h-8 text-sm max-md:h-9"
          />
        </div>
        {tests.length > 0 && (
          <div className="w-44 max-md:w-full">
            <SearchableSelect
              options={tests.map((t) => ({ value: t, label: t }))}
              value={filterTest === 'all' ? '' : filterTest}
              onChange={(v) => setFilterTest(v || 'all')}
              placeholder="Все тесты"
              recentCount={0}
            />
          </div>
        )}
        <Select value={filterKind} onValueChange={setFilterKind}>
          <SelectTrigger className="h-8 text-sm w-44 max-md:data-[size=default]:h-9 max-md:w-auto max-md:min-w-0 max-md:flex-1">
            <SelectValue placeholder="Все типы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Тесты и ДЗ</SelectItem>
            <SelectItem value="test">Только тесты</SelectItem>
            <SelectItem value="homework">Только домашние</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 text-sm w-40 max-md:data-[size=default]:h-9 max-md:w-auto max-md:min-w-0 max-md:flex-1">
            <SelectValue placeholder="Все статусы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="submitted">На проверке</SelectItem>
            <SelectItem value="checked">Завершён</SelectItem>
          </SelectContent>
        </Select>
        {(search || filterTest !== 'all' || filterStatus !== 'all' || filterKind !== 'all' || filterProgram !== 'all') && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
            setSearch(''); setFilterTest('all'); setFilterStatus('all'); setFilterKind('all'); setFilterProgram('all')
          }}>
            Сбросить
          </Button>
        )}
      </div>

      {/* Быстрые теги программ — клик переключает фильтр напрямую, без
          открытия выпадающего списка (программ обычно немного). Повторный
          клик по активному тегу снимает фильтр. Тегов групп здесь нет:
          системные группы «Программа: …» дублировали теги программ и
          загромождали строку. */}
      {programs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {programs.map((p) => (
            <button
              key={`p-${p}`}
              type="button"
              onClick={() => setFilterProgram((prev) => (prev === p ? 'all' : p))}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
                filterProgram === p
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input hover:bg-muted'
              )}
            >
              <Route className="h-3 w-3" />
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <TrendingUp className="h-10 w-10 opacity-40" />
          <p className="text-sm">Нет результатов по заданным фильтрам.</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          {/* Телефон: карточка на попытку вместо 9 колонок таблицы */}
          <ul className="divide-y md:hidden">
            {visible.map((r) => (
              <li key={r.attemptId} className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium leading-snug wrap-break-word">{r.studentName}</p>
                    {(r.grade || r.studyStage === 'student' || r.groupName) && (
                      <p className="mt-0.5 text-xs text-muted-foreground wrap-break-word">
                        {[
                          r.grade || r.studyStage === 'student' ? gradeWithSuffix(r.grade, r.studyStage) : null,
                          r.groupName,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <p>
                      <span className="font-semibold">{r.score}</span>
                      <span className="text-muted-foreground">/{r.maxScore}</span>
                    </p>
                    <p className={cn('text-xs font-semibold', pctTextClass(r.percentage))}>{r.percentage}%</p>
                  </div>
                </div>
                <div className="min-w-0 space-y-0.5 text-sm text-muted-foreground">
                  <div className="flex items-start gap-1.5">
                    <span className="line-clamp-2 wrap-break-word">{r.testTitle}</span>
                    {r.kind === 'homework' && (
                      <Badge variant="outline" className="mt-0.5 text-[10px] px-1 py-0 shrink-0 text-blue-600 border-blue-300">
                        ДЗ
                      </Badge>
                    )}
                  </div>
                  {r.programTitle && (
                    <div className="flex items-start gap-1 text-[11px] text-indigo-600 dark:text-indigo-400">
                      <Route className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="wrap-break-word">{r.programTitle}{r.topicTitle ? ` · ${r.topicTitle}` : ''}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge variant={r.status === 'checked' ? 'default' : 'secondary'} className="text-xs">
                      {r.status === 'checked' ? 'Завершён' : 'На проверке'}
                    </Badge>
                    {r.submittedAt && (
                      <span className="text-xs text-muted-foreground">{new Date(r.submittedAt).toLocaleDateString('ru-RU')}</span>
                    )}
                  </div>
                  <Button
                    variant={r.status === 'submitted' ? 'default' : 'outline'}
                    size="sm"
                    className="h-9 shrink-0"
                    onClick={() => setSelectedAttemptId(r.attemptId)}
                  >
                    {r.status === 'submitted' ? 'Проверить' : 'Детали'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Ученик</th>
                <th className="text-left px-4 py-3 font-medium">Класс</th>
                <th className="text-left px-4 py-3 font-medium">Группа</th>
                <th className="text-left px-4 py-3 font-medium">Задание</th>
                <th className="text-center px-4 py-3 font-medium">Балл</th>
                <th className="text-center px-4 py-3 font-medium">%</th>
                <th className="text-left px-4 py-3 font-medium">Статус</th>
                <th className="text-left px-4 py-3 font-medium">Дата</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {visible.map((r) => (
                <tr key={r.attemptId} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{r.studentName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{gradeLabel(r.grade, r.studyStage)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.groupName ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-48" title={r.testTitle}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{r.testTitle}</span>
                      {r.kind === 'homework' && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0 text-blue-600 border-blue-300">
                          ДЗ
                        </Badge>
                      )}
                    </div>
                    {r.programTitle && (
                      <div className="flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 truncate mt-0.5">
                        <Route className="h-3 w-3 shrink-0" />
                        <span className="truncate">{r.programTitle}{r.topicTitle ? ` · ${r.topicTitle}` : ''}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    <span className="font-semibold">{r.score}</span>
                    <span className="text-muted-foreground">/{r.maxScore}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn(
                      'font-semibold',
                      r.percentage >= 80 ? 'text-green-600' :
                      r.percentage >= 60 ? 'text-orange-500' : 'text-destructive'
                    )}>
                      {r.percentage}%
                    </span>
                    <div className="h-1 w-12 mx-auto mt-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          r.percentage >= 80 ? 'bg-green-500' :
                          r.percentage >= 60 ? 'bg-orange-400' : 'bg-destructive'
                        )}
                        style={{ width: `${r.percentage}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={r.status === 'checked' ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {r.status === 'checked' ? 'Завершён' : 'На проверке'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                    {r.submittedAt ? new Date(r.submittedAt).toLocaleDateString('ru-RU') : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setSelectedAttemptId(r.attemptId)}
                    >
                      {r.status === 'submitted' ? 'Проверить' : 'Детали'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <LoadMoreControl
        hasMore={hasMore}
        loadMore={loadMore}
        remaining={total - showing}
        step={10}
        totalLabel={total > 20 ? `Показано всего ${total} результатов` : undefined}
      />

      <AttemptDrawer
        attemptId={selectedAttemptId}
        onClose={() => setSelectedAttemptId(null)}
        onGraded={handleGraded}
      />
    </>
  )
}
