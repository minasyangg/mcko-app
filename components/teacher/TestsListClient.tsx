'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { usePagination } from '@/lib/hooks/usePagination'
import { LoadMoreControl } from '@/components/shared/LoadMoreControl'
import { BulkDeleteTestsBar } from '@/components/teacher/BulkDeleteTestsBar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { Input } from '@/components/ui/input'
import { Plus, BookOpen, PencilLine, Search, X } from 'lucide-react'
import { DeleteTestButton } from '@/components/teacher/DeleteTestButton'
import { ProposalsListClient, type ProposalRow } from '@/components/teacher/ProposalsListClient'
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

type Tab = 'test' | 'homework' | 'proposals'

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
  rows, isAdmin = false, teachers = [], proposals = [],
}: {
  rows: TestRow[]
  isAdmin?: boolean
  teachers?: { id: string; full_name: string }[]
  /** Предложения ДЗ от агента автосборки — только у учителя (см. ProposalsListClient) */
  proposals?: ProposalRow[]
}) {
  const [tab, setTab] = useState<Tab>('test')
  // фильтр по учителю — только у админа (видит тесты всех)
  const [filterTeacher, setFilterTeacher] = useState<string>('all')
  // поиск и фильтры по предмету/классу — общие для вкладок «Тесты» и «ДЗ»
  const [search, setSearch] = useState('')
  const [subject, setSubject] = useState('')
  const [grade, setGrade] = useState('')

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

  const byTeacher = useMemo(
    () => (isAdmin && filterTeacher !== 'all')
      ? rows.filter(r => r.owner_id === filterTeacher)
      : rows,
    [rows, isAdmin, filterTeacher],
  )

  // Варианты предметов и классов — из самих заданий (с учётом фильтра по
  // учителю), чтобы в списке не было пустых пунктов
  // «физика» и «Физика» — один предмет: ключ в нижнем регистре, подпись с
  // заглавной буквы
  const subjectKey = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
  const subjectOptions = useMemo(() => {
    const byKey = new Map<string, string>()
    for (const r of byTeacher) {
      const key = subjectKey(r.subject)
      if (key && !byKey.has(key)) byKey.set(key, key.charAt(0).toUpperCase() + key.slice(1))
    }
    return [...byKey.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'))
  }, [byTeacher])
  const gradeOptions = useMemo(
    () => [...new Set(byTeacher.map(r => r.grade?.trim()).filter((g): g is string => !!g))]
      .sort((a, b) => (parseInt(a) || 99) - (parseInt(b) || 99) || a.localeCompare(b, 'ru')),
    [byTeacher],
  )

  const filtered = useMemo(() => {
    // «ё» = «е» и регистр не важен: «Тепловые явления» найдутся по «тепловы»
    const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е')
    const q = norm(search.trim())
    return byTeacher.filter(r =>
      (!subject || subjectKey(r.subject) === subject) &&
      (!grade || r.grade?.trim() === grade) &&
      (!q || norm(`${r.title} ${r.subject ?? ''}`).includes(q)))
  }, [byTeacher, search, subject, grade])
  const filtersActive = !!(search.trim() || subject || grade)

  // смена фильтра снимает выбор: иначе «удалить выбранные» задело бы строки,
  // которых уже не видно
  const changeFilter = (fn: () => void) => { fn(); setSelected(new Set()) }
  const resetFilters = () => changeFilter(() => { setSearch(''); setSubject(''); setGrade('') })

  const tests = filtered.filter(r => r.kind !== 'homework')
  const homework = filtered.filter(r => r.kind === 'homework')
  const current = tab === 'test' ? tests : tab === 'homework' ? homework : []

  // По 15 строк на вкладку, возврат к первым 15 — при смене вкладки
  // «Тесты»/«Домашние задания» или любого фильтра
  const { visible: pagedCurrent, hasMore, loadMore, total, showing } =
    usePagination(current, 15, 15, `${tab}|${filterTeacher}|${search}|${subject}|${grade}`)

  const pendingProposals = proposals.filter(p => p.status === 'pending').length

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'test', label: 'Тесты', count: tests.length },
    { key: 'homework', label: 'Домашние задания', count: homework.length },
    // Предложения ДЗ от агента автосборки — бейдж считает только «ждут решения»,
    // не все записи (иначе «собрано»/«просрочено» из прошлого раздували бы счётчик)
    { key: 'proposals', label: 'Предложения агента', count: pendingProposals },
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
        {tab !== 'proposals' && (
          <Button asChild>
            <Link href={`/teacher/tests/new?kind=${tab}`}>
              <Plus className="h-4 w-4 mr-2" />
              {tab === 'test' ? 'Создать тест' : 'Создать задание'}
            </Link>
          </Button>
        )}
      </div>

      {tab === 'proposals' ? (
        <>
          <p className="text-xs text-muted-foreground max-w-2xl">
            Автоматически собранные темы ДЗ — подтвердите или отредактируйте перед публикацией.
          </p>
          <ProposalsListClient initialProposals={proposals} />
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground max-w-2xl">
            {tab === 'test'
              ? 'Тесты имеют тип, разбаловку и критерии, привязанные к правилам оценивания — проверяются автоматически по правилам.'
              : 'Домашнее задание собирается из готовых заданий книг или библиотеки задач; баллы задаёт сам учитель.'}
          </p>

          {/* Поиск и фильтры — общие для вкладок «Тесты» и «Домашние задания» */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => changeFilter(() => setSearch(e.target.value))}
                placeholder="Поиск по названию"
                className="h-9 pl-8 text-sm"
                aria-label="Поиск по названию"
              />
            </div>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={subject}
              onChange={(e) => changeFilter(() => setSubject(e.target.value))}
              aria-label="Предмет"
            >
              <option value="">Все предметы</option>
              {subjectOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={grade}
              onChange={(e) => changeFilter(() => setGrade(e.target.value))}
              aria-label="Класс"
            >
              <option value="">Все классы</option>
              {gradeOptions.map(g => <option key={g} value={g}>{/^\d+$/.test(g) ? `${g} класс` : g}</option>)}
            </select>
            {/* Фильтр по учителю — только админу (видит все тесты организации) */}
            {isAdmin && teachers.length > 1 && (
              <div className="w-56 shrink-0">
                <SearchableSelect
                  options={teachers.map(t => ({ value: t.id, label: t.full_name }))}
                  value={filterTeacher === 'all' ? '' : filterTeacher}
                  onChange={(v) => changeFilter(() => setFilterTeacher(v || 'all'))}
                  placeholder="Все учителя"
                  recentCount={0}
                />
              </div>
            )}
            {filtersActive && (
              <Button variant="ghost" size="sm" className="h-9" onClick={resetFilters}>
                <X className="mr-1 h-3.5 w-3.5" /> Сбросить
              </Button>
            )}
          </div>

          {current.length === 0 && filtersActive ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
              <Search className="h-10 w-10 opacity-40" />
              <p>По фильтрам ничего не найдено.</p>
              <Button variant="outline" onClick={resetFilters}>Сбросить фильтры</Button>
            </div>
          ) : current.length === 0 ? (
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
                rows={pagedCurrent}
                showExamType={tab === 'test'}
                showOwner={isAdmin}
                selected={selected}
                onToggle={toggle}
                onToggleAll={toggleAll}
              />
              <LoadMoreControl
                hasMore={hasMore}
                loadMore={loadMore}
                remaining={total - showing}
                step={15}
                totalLabel={total > 15 ? `Показано всего ${total}` : undefined}
              />
            </div>
          )}
        </>
      )}
    </>
  )
}
