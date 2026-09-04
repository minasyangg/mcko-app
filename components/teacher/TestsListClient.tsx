'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { BulkDeleteTestsBar } from '@/components/teacher/BulkDeleteTestsBar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Plus, BookOpen, PencilLine } from 'lucide-react'
import { DeleteTestButton } from '@/components/teacher/DeleteTestButton'
import { cn } from '@/lib/utils'

export interface TestRow {
  id: string
  title: string
  subject: string | null
  grade: string | null
  exam_type: string | null
  status: string
  is_active: boolean
  created_at: string | null
  kind: string
  owner_id?: string | null
  owner_name?: string | null
}

const statusLabel: Record<string, string> = {
  draft: 'Черновик',
  in_review: 'На проверке',
  published: 'Опубликован',
  archived: 'Архив',
}

const statusVariant: Record<string, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  in_review: 'secondary',
  published: 'default',
  archived: 'outline',
}

type Tab = 'test' | 'homework'

// showExamType=false — вкладка ДЗ: у домашних заданий нет типа экзамена
// showOwner=true — админ видит тесты всех учителей, показываем автора
function TestsTable({
  rows, showExamType = true, showOwner = false, selected, onToggle, onToggleAll,
}: {
  rows: TestRow[]
  showExamType?: boolean
  showOwner?: boolean
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: (ids: string[], checked: boolean) => void
}) {
  const allChecked = rows.length > 0 && rows.every(r => selected.has(r.id))
  return (
    <div className="rounded-md border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="w-10 px-3 py-3">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={allChecked}
                onChange={(e) => onToggleAll(rows.map(r => r.id), e.target.checked)}
                title="Выбрать все на вкладке"
              />
            </th>
            <th className="text-left px-4 py-3 font-medium">Название</th>
            {showOwner && <th className="text-left px-4 py-3 font-medium">Учитель</th>}
            <th className="text-left px-4 py-3 font-medium">Предмет</th>
            <th className="text-left px-4 py-3 font-medium">Класс</th>
            {showExamType && <th className="text-left px-4 py-3 font-medium">Тип</th>}
            <th className="text-left px-4 py-3 font-medium">Статус</th>
            <th className="text-left px-4 py-3 font-medium">Создан</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((test) => (
            <tr key={test.id} className="hover:bg-muted/30 transition-colors">
              <td className="px-3 py-3">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selected.has(test.id)}
                  onChange={() => onToggle(test.id)}
                />
              </td>
              <td className="px-4 py-3 font-medium">{test.title}</td>
              {showOwner && <td className="px-4 py-3 text-muted-foreground">{test.owner_name ?? '—'}</td>}
              <td className="px-4 py-3 text-muted-foreground">{test.subject ?? '—'}</td>
              <td className="px-4 py-3 text-muted-foreground">{test.grade ?? '—'}</td>
              {showExamType && <td className="px-4 py-3 text-muted-foreground">{test.exam_type ?? '—'}</td>}
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant={statusVariant[test.status] ?? 'secondary'}>
                    {statusLabel[test.status] ?? test.status}
                  </Badge>
                  {test.status === 'published' && !test.is_active && (
                    <Badge variant="outline" className="text-orange-600 border-orange-400 text-xs">
                      Снят
                    </Badge>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {test.created_at ? new Date(test.created_at).toLocaleDateString('ru-RU') : '—'}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1 justify-end">
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/teacher/tests/${test.id}`}>Открыть</Link>
                  </Button>
                  <DeleteTestButton testId={test.id} testTitle={test.title} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Раздел «Задания»: вкладки «Тесты» (тип/разбаловка/критерии по правилам,
// автопроверка) и «Домашние задания» (баллы задаёт сам учитель при
// составлении/назначении). Механика прохождения общая, kind — маркер.
export function TestsListClient({
  rows, isAdmin = false, teachers = [],
}: {
  rows: TestRow[]
  isAdmin?: boolean
  teachers?: { id: string; full_name: string }[]
}) {
  const [tab, setTab] = useState<Tab>('test')
  // фильтр по учителю — только у админа (видит тесты всех)
  const [filterTeacher, setFilterTeacher] = useState<string>('all')

  // Массовый выбор для удаления. Сбрасывается при смене вкладки: набор строк
  // там другой, и «выбрано 5» от прошлой вкладки сбивало бы с толку.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setSelected(prev => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })
  const toggleAll = (ids: string[], checked: boolean) => setSelected(prev => {
    const n = new Set(prev)
    for (const id of ids) { if (checked) n.add(id); else n.delete(id) }
    return n
  })

  const filtered = useMemo(
    () => (isAdmin && filterTeacher !== 'all')
      ? rows.filter(r => r.owner_id === filterTeacher)
      : rows,
    [rows, isAdmin, filterTeacher],
  )

  const tests = filtered.filter(r => r.kind !== 'homework')
  const homework = filtered.filter(r => r.kind === 'homework')
  const current = tab === 'test' ? tests : homework

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'test', label: 'Тесты', count: tests.length },
    { key: 'homework', label: 'Домашние задания', count: homework.length },
  ]

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 border-b flex-1">
          {tabs.map(t => (
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
                <span className="ml-2 rounded-full px-1.5 py-0.5 text-xs font-semibold bg-muted text-muted-foreground">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <Button asChild>
          <Link href={`/teacher/tests/new?kind=${tab}`}>
            <Plus className="h-4 w-4 mr-2" />
            {tab === 'test' ? 'Создать тест' : 'Создать задание'}
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground max-w-2xl">
          {tab === 'test'
            ? 'Тесты имеют тип, разбаловку и критерии, привязанные к правилам оценивания — проверяются автоматически по правилам.'
            : 'Домашнее задание собирается из готовых заданий книг или библиотеки задач; баллы задаёт сам учитель.'}
        </p>
        {/* Фильтр по учителю — только админу (видит все тесты организации) */}
        {isAdmin && teachers.length > 1 && (
          <Select value={filterTeacher} onValueChange={setFilterTeacher}>
            <SelectTrigger className="h-8 text-sm w-56 shrink-0">
              <SelectValue placeholder="Все учителя" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все учителя</SelectItem>
              {teachers.map(t => (
                <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {current.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          {tab === 'test' ? <BookOpen className="h-10 w-10 opacity-40" /> : <PencilLine className="h-10 w-10 opacity-40" />}
          <p>{tab === 'test' ? 'Нет тестов. Создайте первый тест.' : 'Нет домашних заданий. Создайте первое.'}</p>
          <Button asChild variant="outline">
            <Link href={`/teacher/tests/new?kind=${tab}`}>
              {tab === 'test' ? 'Создать тест' : 'Создать задание'}
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <BulkDeleteTestsBar
            selectedIds={[...selected]}
            onClear={() => setSelected(new Set())}
            label={tab === 'homework' ? 'ДЗ' : 'тест'}
          />
          <TestsTable
            rows={current}
            showExamType={tab === 'test'}
            showOwner={isAdmin}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
          />
        </div>
      )}
    </>
  )
}
