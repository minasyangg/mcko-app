'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePolling } from '@/lib/hooks/usePolling'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ConfirmDeleteAction } from '@/components/shared/ConfirmDeleteAction'
import { AttemptDrawer } from '@/components/teacher/AttemptDrawer'
import { AssignmentsPanel, type AssignmentRow } from '@/components/teacher/AssignmentsPanel'
import { CloseAssignmentButton } from '@/components/teacher/CloseAssignmentButton'
import type { ProgramSummaryRow } from '@/lib/roadmaps/progress'
import { TableFilterBar, useTableFilter, type FilterField } from '@/components/shared/TableFilter'
import { StatusChip } from '@/components/shared/StatusChip'
import { Trash2, CheckCheck, Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface AttemptRow {
  id: string
  student_id: string
  assignment_id: string
  /** null — назначение открыто для ученика; см. lib/assignments/completion */
  closed_reason: string | null
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
  isAdmin?: boolean
  assignments?: AssignmentRow[]
  programSummaries?: ProgramSummaryRow[]
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

type Tab = 'assignments' | 'active' | 'review' | 'checked'

function TableView({ rows, tab, isAdmin, onSelect, onDelete, onFinish }: {
  rows: AttemptRow[]
  tab: Tab
  isAdmin: boolean
  onSelect: (id: string) => void
  onDelete: (a: AttemptRow) => void
  onFinish: (a: AttemptRow) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Нет попыток в этом разделе
      </div>
    )
  }
  const showDelete = isAdmin && tab === 'checked'
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Ученик</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Класс</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Тест</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Статус</th>
            <th className="px-4 py-3 text-center font-medium text-muted-foreground">Балл</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Активность</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const used = a.total_attempts ?? 1
            const max = a.max_attempts ?? 1
            return (
              <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium">{a.full_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{a.grade ?? '—'}</td>
                <td className="px-4 py-3 max-w-50 text-muted-foreground">
                  <div className="truncate" title={a.test_title}>{a.test_title}</div>
                  {tab === 'checked' && (
                    <div className="text-[11px] text-muted-foreground/80 mt-0.5">
                      Попыток: {used} из {max}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3"><StatusChip status={a.status} attemptNumber={a.attempt_number} maxAttempts={a.max_attempts} /></td>
                <td className="px-4 py-3 text-center font-medium tabular-nums">
                  {a.score !== null ? `${a.score}/${a.max_score ?? '?'}` : '—'}
                </td>
                {/* Объединённый столбец: когда начата + последняя активность */}
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                  <div>{formatRelative(a.last_activity_at)}</div>
                  {a.started_at && (
                    <div className="text-[11px] text-muted-foreground/70">начата {formatTime(a.started_at)}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center gap-1 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => onSelect(a.id)}>
                      {['submitted', 'under_review'].includes(a.status) ? 'Проверить' : 'Подробнее'}
                    </Button>
                    {isAdmin && tab === 'active' && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm"
                            className="h-8 px-2 text-xs text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                            title="Сдать текущую попытку за ученика (оставшиеся попытки сохраняются)">
                            <CheckCheck className="h-3.5 w-3.5 mr-1" />
                            Сдать попытку
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Завершить попытку?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Попытка ученика <b>{a.full_name}</b> по тесту «{a.test_title}» будет
                              принудительно завершена и проверена автоматически — даже если время
                              не истекло. Не начатая попытка получит статус «истекла».
                              Оставшиеся попытки у ученика сохранятся — чтобы закрыть тест
                              целиком, используйте «Завершить тест».
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Отмена</AlertDialogCancel>
                            <AlertDialogAction onClick={() => onFinish(a)}>
                              Завершить
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    {/* Завершение всего теста для ученика — доступно и учителю
                        (владельцу назначения), в отличие от «сдать попытку» */}
                    <CloseAssignmentButton
                      assignmentId={a.assignment_id}
                      studentId={a.student_id}
                      closedReason={a.closed_reason}
                      targetLabel={`Ученик ${a.full_name} по тесту «${a.test_title}»`}
                      size="row"
                      label="Завершить тест"
                    />
                    {showDelete && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            title="Удалить попытку">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogMedia className="bg-destructive/10 text-destructive">
                              <AlertTriangle />
                            </AlertDialogMedia>
                            <AlertDialogTitle>Удалить попытку?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Попытка ученика <b>{a.full_name}</b> по тесту «{a.test_title}» будет
                              удалена безвозвратно вместе с ответами. Накопительный результат
                              пересчитается по оставшимся попыткам.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Отмена</AlertDialogCancel>
                            <ConfirmDeleteAction onConfirm={() => onDelete(a)} />
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const FILTER_FIELDS: FilterField[] = [
  { key: 'full_name',   label: 'Ученик', type: 'text',   placeholder: 'Поиск по ФИО', width: 'w-48' },
  { key: 'grade',       label: 'Класс',  type: 'select',                               width: 'w-28' },
  { key: 'test_title',  label: 'Тест',   type: 'text',   placeholder: 'Поиск по тесту', width: 'w-48' },
]

export function MonitorTable({ initialAttempts, isAdmin = false, assignments = [], programSummaries = [] }: Props) {
  const [attempts, setAttempts] = useState<AttemptRow[]>(initialAttempts)

  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('assignments')
  const [finishingAll, setFinishingAll] = useState(false)
  const router = useRouter()

  // Пересинхронизация с сервером. Состояние инициализируется из initialAttempts
  // ОДИН раз, поэтому router.refresh() (его зовёт «Завершить тест»/«Открыть» в
  // CloseAssignmentButton) молча ничего не менял: сервер присылал свежие строки,
  // а таблица продолжала показывать старый стейт до ручной перезагрузки — из-за
  // этого не двигались ни подписи кнопок, ни счётчики на табах.
  useEffect(() => { setAttempts(initialAttempts) }, [initialAttempts])

  async function handleDelete(a: AttemptRow) {
    const res = await fetch(`/api/admin/attempts/${a.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(json.error ?? 'Ошибка удаления'); return }
    setAttempts(prev => prev.filter(x => x.id !== a.id))
    const used = json.attempts_used ?? 0
    const max = json.max_attempts ?? 1
    const last = json.last_score != null ? `, результат последней: ${json.last_score}/${json.last_max ?? '?'}` : ''
    toast.success(`Попытка удалена. Использовано ${used} из ${max}${last}`)
    // Локального фильтра мало: счётчики табов и «использовано N из M» считает
    // сервер по student_final_results — без refresh они остаются старыми.
    router.refresh()
  }

  async function handleFinish(a: AttemptRow) {
    const res = await fetch(`/api/admin/attempts/${a.id}/finish`, { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(json.error ?? 'Ошибка завершения'); return }
    setAttempts(prev => prev.map(x => x.id === a.id
      ? { ...x, status: json.status ?? 'submitted', score: json.score ?? x.score, max_score: json.max_score ?? x.max_score }
      : x
    ))
    toast.success(json.status === 'expired'
      ? 'Попытка помечена как истёкшая (ученик не приступал)'
      : `Попытка завершена: ${json.score ?? 0}/${json.max_score ?? '?'}`)
    router.refresh()
  }

  async function handleFinishAll() {
    setFinishingAll(true)
    try {
      const res = await fetch('/api/admin/attempts/finish-all', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка'); return }
      toast.success(`Завершено попыток: ${json.finished}${json.expired ? `, истекло не начатых: ${json.expired}` : ''}`)
      // Локально убираем активные — они уйдут в другие вкладки после refetch
      setAttempts(prev => prev.map(x =>
        ['in_progress', 'not_started'].includes(x.status)
          ? { ...x, status: x.status === 'not_started' ? 'expired' : 'submitted' }
          : x
      ))
      router.refresh()
    } finally {
      setFinishingAll(false)
    }
  }

  // Живое обновление таблицы — единый механизм с бейджами в TeacherNav (см.
  // lib/hooks/usePolling). Раньше здесь была подписка на postgres_changes,
  // которая в этом проекте молча не работает (publication supabase_realtime
  // пуста): сырой статус из неё ещё и перезатирал вычисленный «completed»
  // обратно на «checked», из-за чего проверенная работа с исчерпанными
  // попытками навсегда оставалась в табе «На проверке». router.refresh()
  // подтягивает пересчитанные строки с сервера (включая статус/баллы), тот
  // же вызов уже используется после действий учителя (delete/finish/grade).
  usePolling(() => router.refresh())

  const active  = attempts.filter((a) => ['not_started', 'in_progress'].includes(a.status))
  // «На проверке» включает и уже авто-проверенные (checked) попытки — иначе
  // 100%-автоматическая проверка (в т.ч. ошибочная, см. ключи с неверным
  // grading_method) уходит сразу в «Проверено» и учитель её никогда не видит.
  // Дублируется с «Проверено» намеренно: это витрина «покажи мне, что
  // проверено, и дай проверить/убедиться» — НО только пока это не подтвердил
  // человек. Как только учитель САМ проверил и сохранил оценку, сервер сразу
  // переводит статус в «completed» (см. teacher_reviewed_at, миграция 057, и
  // app/teacher/monitor/page.tsx) — независимо от того, остались ли у ученика
  // попытки. Поэтому «checked» здесь — это ровно то, что проверено только
  // автоматически и ждёт человека; «completed» сюда не входит (раньше входило
  // тоже, и работа Власенко Глеба зависала в «На проверке» навсегда даже
  // после ручной проверки).
  const review  = attempts.filter((a) => ['submitted', 'under_review', 'checked'].includes(a.status))
  const checked = attempts.filter((a) => ['checked', 'completed'].includes(a.status))

  const tabRows = tab === 'active' ? active : tab === 'review' ? review : tab === 'checked' ? checked : []

  const { filtered, filters, setFilter, clearFilters, hasActiveFilters } =
    useTableFilter(tabRows, FILTER_FIELDS)

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'assignments', label: 'Назначения', count: assignments.length },
    { key: 'active',  label: 'В процессе',  count: active.length },
    { key: 'review',  label: 'На проверке', count: review.length },
    { key: 'checked', label: 'Проверено',   count: checked.length },
  ]

  return (
    <>
      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); clearFilters() }}
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

      {/* Первый таб — назначения (перенесены из отдельного раздела) */}
      {tab === 'assignments' && (
        <AssignmentsPanel rows={assignments} programSummaries={programSummaries} isAdmin={isAdmin} />
      )}

      {/* Filters + bulk action */}
      {tab !== 'assignments' && (
      <div className="flex items-start justify-between gap-3">
        <TableFilterBar
          fields={FILTER_FIELDS}
          filters={filters}
          setFilter={setFilter}
          clearFilters={clearFilters}
          hasActiveFilters={hasActiveFilters}
          data={tabRows}
        />
        {isAdmin && tab === 'active' && active.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={finishingAll} className="shrink-0 mt-1">
                {finishingAll ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCheck className="h-4 w-4 mr-1.5" />}
                Завершить все
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Завершить все активные попытки?</AlertDialogTitle>
                <AlertDialogDescription>
                  Все попытки «в процессе» будут принудительно завершены и проверены
                  автоматически — даже если время не истекло и попытки не израсходованы.
                  Ученики, не приступившие к тесту, получат статус «истекла».
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={finishingAll}>Отмена</AlertDialogCancel>
                <AlertDialogAction onClick={(e) => { e.preventDefault(); handleFinishAll() }} disabled={finishingAll}>
                  {finishingAll ? 'Завершение...' : 'Завершить все'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      )}

      {tab !== 'assignments' && (
      <div className="rounded-md border overflow-hidden">
        <TableView rows={filtered} tab={tab} isAdmin={isAdmin} onSelect={setSelectedAttemptId} onDelete={handleDelete} onFinish={handleFinish} />
      </div>
      )}

      <AttemptDrawer
        attemptId={selectedAttemptId}
        onClose={() => setSelectedAttemptId(null)}
        onGraded={(id, score) => {
          // status здесь намеренно не трогаем: сырое «checked» из PATCH — не то
          // же самое, что вычисленный статус таблицы. После ручной проверки
          // сервер сразу переведёт её в «completed» (teacher_reviewed_at,
          // миграция 057) — этот пересчёт придёт с router.refresh() ниже.
          setAttempts((prev) => prev.map((a) => a.id === id ? { ...a, score } : a))
          setSelectedAttemptId(null)
          router.refresh()
        }}
      />
    </>
  )
}
