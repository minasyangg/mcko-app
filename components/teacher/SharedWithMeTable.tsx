'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePagination } from '@/lib/hooks/usePagination'
import { LoadMoreControl } from '@/components/shared/LoadMoreControl'
import { TableFilterBar, useTableFilter, type FilterField } from '@/components/shared/TableFilter'
import { AttemptDrawer } from '@/components/teacher/AttemptDrawer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ClipboardList, Eye } from 'lucide-react'

export interface SharedRow {
  share_id: string
  assignment_id: string
  student_id: string
  student_name: string
  grade: string | null
  test_title: string
  subject: string | null
  exam_type: string | null
  sender_name: string
  score: number | null
  max_score: number | null
  expires_at: string
}

const FILTER_FIELDS: FilterField[] = [
  { key: 'student_name', label: 'Ученик',   type: 'text',   placeholder: 'Поиск по ФИО', width: 'w-48' },
  { key: 'subject',      label: 'Предмет',  type: 'select',                              width: 'w-36' },
  { key: 'sender_name',  label: 'Учитель',  type: 'select',                              width: 'w-40' },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

// Список работ, которыми ученики поделились с этим учителем (assignment_shares,
// 087) — фильтры/пагинация по тому же клиентскому паттерну, что MonitorTable
// (TableFilterBar/useTableFilter поверх уже загруженного сервером массива,
// usePagination/LoadMoreControl для «показать ещё» — сервер отдаёт разумный
// LIMIT (500) одним запросом, без отдельной пагинации на бэкенде).
export function SharedWithMeTable({ initialRows }: { initialRows: SharedRow[] }) {
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null)

  const { filtered, filters, setFilter, clearFilters, hasActiveFilters } =
    useTableFilter(initialRows, FILTER_FIELDS)

  const { visible: pagedRows, hasMore, loadMore, total, showing } =
    usePagination(filtered, 15, 15, JSON.stringify(filters))

  async function openAttempt(assignmentId: string, studentId: string) {
    // AttemptDrawer работает с attempt_id, а не assignment_id — находим
    // актуальную (последнюю submitted/checked) попытку. RLS ("attempts:
    // teacher read via share") уже гарантирует, что мы увидим только то,
    // что реально расшарено этому учителю — но для ГРУППОВОГО назначения
    // один и тот же assignment_id общий для всех учеников группы, и без
    // фильтра по student_id клик на строку ученика А мог открыть попытку
    // ученика Б (если Б сдал позже — .order(submitted_at desc).limit(1)
    // выбирал бы её, не привязываясь к строке, на которую нажали).
    const supabase = createClient()
    const { data } = await supabase
      .from('attempts')
      .select('id')
      .eq('assignment_id', assignmentId)
      .eq('student_id', studentId)
      .in('status', ['submitted', 'checked'])
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setSelectedAttemptId(data?.id ?? null)
  }

  if (initialRows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
        <ClipboardList className="h-10 w-10 opacity-40" />
        <p>Пока ничего не расшарено — ученики делятся сданными работами сами, по своей инициативе.</p>
      </div>
    )
  }

  return (
    <>
      <TableFilterBar
        fields={FILTER_FIELDS}
        filters={filters}
        setFilter={setFilter}
        clearFilters={clearFilters}
        hasActiveFilters={hasActiveFilters}
        data={initialRows}
      />

      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Ученик</th>
              <th className="text-left px-4 py-3 font-medium">Тест</th>
              <th className="text-left px-4 py-3 font-medium">Учитель</th>
              <th className="text-left px-4 py-3 font-medium">Балл</th>
              <th className="text-left px-4 py-3 font-medium">Доступ до</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {pagedRows.map(r => (
              <tr key={r.share_id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium">
                  {r.student_name}
                  {r.grade && <span className="text-muted-foreground ml-1.5 text-xs">{r.grade}</span>}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {r.test_title}
                  {r.subject && <Badge variant="outline" className="ml-1.5 text-[11px]">{r.subject}</Badge>}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{r.sender_name}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {r.score != null && r.max_score != null ? `${r.score}/${r.max_score}` : '—'}
                </td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDate(r.expires_at)}</td>
                <td className="px-4 py-3">
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openAttempt(r.assignment_id, r.student_id)}>
                    <Eye className="h-3.5 w-3.5 mr-1.5" /> Открыть
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <LoadMoreControl
        hasMore={hasMore}
        loadMore={loadMore}
        remaining={total - showing}
        step={15}
        totalLabel={total > 15 ? `Показано всего ${total} строк` : undefined}
      />

      <AttemptDrawer
        attemptId={selectedAttemptId}
        readOnly
        onClose={() => setSelectedAttemptId(null)}
      />
    </>
  )
}
