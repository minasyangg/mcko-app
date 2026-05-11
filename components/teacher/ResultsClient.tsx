'use client'

import { useState, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { AttemptDrawer } from '@/components/teacher/AttemptDrawer'
import { TrendingUp, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AttemptRow } from '@/lib/analytics/queries'

interface Props {
  rows: AttemptRow[]
  tests: string[]
  groups: string[]
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-1">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

export function ResultsClient({ rows, tests, groups }: Props) {
  const [search, setSearch] = useState('')
  const [filterTest, setFilterTest] = useState('all')
  const [filterGroup, setFilterGroup] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null)
  const [updatedRows, setUpdatedRows] = useState<AttemptRow[]>(rows)

  const filtered = useMemo(() => {
    return updatedRows.filter((r) => {
      if (search && !r.studentName.toLowerCase().includes(search.toLowerCase())) return false
      if (filterTest !== 'all' && r.testTitle !== filterTest) return false
      if (filterGroup !== 'all' && r.groupName !== filterGroup) return false
      if (filterStatus !== 'all' && r.status !== filterStatus) return false
      return true
    })
  }, [updatedRows, search, filterTest, filterGroup, filterStatus])

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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Всего попыток" value={filtered.length} />
        <StatCard label="Средний балл" value={avgScore} sub={`${avgPct}% в среднем`} />
        <StatCard label="Проверено" value={checkedCount} sub={`${filtered.length - checkedCount} осталось`} />
        <StatCard label="На проверке" value={pendingCount} sub="ожидают учителя" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по ученику..."
            className="pl-8 h-8 text-sm"
          />
        </div>
        {tests.length > 0 && (
          <Select value={filterTest} onValueChange={setFilterTest}>
            <SelectTrigger className="h-8 text-sm w-44">
              <SelectValue placeholder="Все тесты" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все тесты</SelectItem>
              {tests.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {groups.length > 0 && (
          <Select value={filterGroup} onValueChange={setFilterGroup}>
            <SelectTrigger className="h-8 text-sm w-36">
              <SelectValue placeholder="Все группы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все группы</SelectItem>
              {groups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 text-sm w-40">
            <SelectValue placeholder="Все статусы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="submitted">На проверке</SelectItem>
            <SelectItem value="checked">Завершён</SelectItem>
          </SelectContent>
        </Select>
        {(search || filterTest !== 'all' || filterGroup !== 'all' || filterStatus !== 'all') && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
            setSearch(''); setFilterTest('all'); setFilterGroup('all'); setFilterStatus('all')
          }}>
            Сбросить
          </Button>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <TrendingUp className="h-10 w-10 opacity-40" />
          <p className="text-sm">Нет результатов по заданным фильтрам.</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Ученик</th>
                <th className="text-left px-4 py-3 font-medium">Класс</th>
                <th className="text-left px-4 py-3 font-medium">Группа</th>
                <th className="text-left px-4 py-3 font-medium">Тест</th>
                <th className="text-center px-4 py-3 font-medium">Балл</th>
                <th className="text-center px-4 py-3 font-medium">%</th>
                <th className="text-left px-4 py-3 font-medium">Статус</th>
                <th className="text-left px-4 py-3 font-medium">Дата</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((r) => (
                <tr key={r.attemptId} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{r.studentName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.grade ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.groupName ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-40 truncate" title={r.testTitle}>
                    {r.testTitle}
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
      )}

      <AttemptDrawer
        attemptId={selectedAttemptId}
        onClose={() => setSelectedAttemptId(null)}
        onGraded={handleGraded}
      />
    </>
  )
}
