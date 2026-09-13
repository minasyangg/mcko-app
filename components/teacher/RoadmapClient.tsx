'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Plus, Route, Users, ListChecks, GripVertical } from 'lucide-react'
import { EditRoadmapDialog } from '@/components/teacher/EditRoadmapDialog'
import { AdminAuthorNotice } from '@/components/shared/AdminAuthorNotice'

export interface RoadmapRow {
  id: string
  title: string
  subject: string | null
  description: string | null
  sort_order: number
  topic_count: number
  student_count: number
}

const NO_SUBJECT_LABEL = 'Без предмета'

export function RoadmapClient({ roadmaps: initialRoadmaps }: { roadmaps: RoadmapRow[] }) {
  const router = useRouter()
  const [roadmaps, setRoadmaps] = useState(initialRoadmaps)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', subject: '', description: '' })
  const [creating, setCreating] = useState(false)

  // Группы по предмету — сам предмет отсортирован по алфавиту, «Без
  // предмета» всегда последней (не смешивается с алфавитом, который у
  // пустой строки был бы первым). Внутри группы — sort_order (свободный
  // порядок, задаётся перетаскиванием).
  //
  // Группировка идёт по ключу без учёта регистра («Физика» и «физика» — одна
  // группа, живой случай — предмет вводится свободным текстом при создании
  // программы и легко расходится в написании), но заголовок секции и
  // subjectKey для handleDrop/фильтрации берём как есть у первой попавшейся
  // программы группы — переписывать r.subject не нужно, отображаем то, что
  // ввёл учитель.
  const groups = useMemo(() => {
    const bySubject = new Map<string, { label: string; rows: RoadmapRow[] }>()
    for (const r of roadmaps) {
      const trimmed = r.subject?.trim() || ''
      const dedupeKey = trimmed ? trimmed.toLowerCase() : NO_SUBJECT_LABEL
      if (!bySubject.has(dedupeKey)) bySubject.set(dedupeKey, { label: trimmed || NO_SUBJECT_LABEL, rows: [] })
      bySubject.get(dedupeKey)!.rows.push(r)
    }
    for (const g of bySubject.values()) g.rows.sort((a, b) => a.sort_order - b.sort_order)
    return [...bySubject.entries()].sort(([keyA], [keyB]) => {
      if (keyA === NO_SUBJECT_LABEL) return 1
      if (keyB === NO_SUBJECT_LABEL) return -1
      return keyA.localeCompare(keyB, 'ru')
    })
  }, [roadmaps])

  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  async function persistOrder(ids: string[]) {
    const res = await fetch('/api/roadmaps/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roadmap_ids: ids }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Не удалось сохранить порядок')
      router.refresh()
    }
  }

  function dedupeKeyOf(r: RoadmapRow): string {
    const trimmed = r.subject?.trim() || ''
    return trimmed ? trimmed.toLowerCase() : NO_SUBJECT_LABEL
  }

  // Общее ядро перестановки: из позиции from в позицию to внутри группы
  // предмета. Используется и drag-and-drop'ом, и кнопками-стрелками.
  function reorderWithin(dedupeKey: string, from: number, to: number) {
    setRoadmaps(prev => {
      const groupIds = prev
        .filter(r => dedupeKeyOf(r) === dedupeKey)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(r => r.id)
      if (from === -1 || to === -1 || from === to) return prev
      if (to < 0 || to >= groupIds.length) return prev
      const reordered = [...groupIds]
      const [moved] = reordered.splice(from, 1)
      reordered.splice(to, 0, moved)

      const orderById = new Map(reordered.map((id, i) => [id, i + 1]))
      const next = prev.map(r => orderById.has(r.id) ? { ...r, sort_order: orderById.get(r.id)! } : r)
      persistOrder(reordered)
      return next
    })
  }

  function indexWithin(dedupeKey: string, id: string): number {
    return roadmaps
      .filter(r => dedupeKeyOf(r) === dedupeKey)
      .sort((a, b) => a.sort_order - b.sort_order)
      .findIndex(r => r.id === id)
  }

  function handleDrop(dedupeKey: string, targetId: string) {
    const draggedId = dragId
    setDragId(null)
    setOverId(null)
    if (!draggedId || draggedId === targetId) return
    reorderWithin(dedupeKey, indexWithin(dedupeKey, draggedId), indexWithin(dedupeKey, targetId))
  }

  async function handleCreate() {
    setCreating(true)
    try {
      const res = await fetch('/api/roadmaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Ошибка создания'); return }
      toast.success('Программа создана')
      setOpen(false)
      router.push(`/teacher/roadmaps/${json.id}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Программы</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Учебные маршруты (road map): темы с прикреплёнными ДЗ и тестами для ваших учеников
          </p>
        </div>
        <Button onClick={() => { setForm({ title: '', subject: '', description: '' }); setOpen(true) }}>
          <Plus className="h-4 w-4 mr-2" />
          Создать программу
        </Button>
      </div>

      <AdminAuthorNotice what="программа" />

      {roadmaps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          <Route className="h-10 w-10 opacity-40" />
          <p>Пока нет программ. Создайте первую и добавьте темы с заданиями.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(([dedupeKey, { label, rows }]) => (
            <div key={dedupeKey} className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {label}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((r) => (
                  <div
                    key={r.id}
                    className="relative"
                    onDragOver={rows.length > 1 ? (e) => { e.preventDefault(); setOverId(r.id) } : undefined}
                    onDrop={rows.length > 1 ? (e) => { e.preventDefault(); handleDrop(dedupeKey, r.id) } : undefined}
                  >
                    {/* Кнопка лежит НАД ссылкой-карточкой: вложить её в <Link> нельзя —
                        клик по кнопке уходил бы в переход на страницу программы */}
                    <div className="absolute right-2 top-2 z-10">
                      <EditRoadmapDialog
                        roadmapId={r.id}
                        title={r.title}
                        subject={r.subject}
                        description={r.description}
                      />
                    </div>
                    {rows.length > 1 && (
                      <div className="absolute left-1.5 top-1.5 z-10 flex items-center">
                        <span
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move'
                            e.dataTransfer.setData('text/plain', r.id)
                            setDragId(r.id)
                          }}
                          onDragEnd={() => { setDragId(null); setOverId(null) }}
                          className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground"
                          title="Перетащите, чтобы изменить порядок"
                        >
                          <GripVertical className="h-4 w-4" />
                        </span>
                      </div>
                    )}
                    <Link href={`/teacher/roadmaps/${r.id}`}>
                    <Card
                      className={cn(
                        'h-full hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer',
                        overId === r.id && dragId !== r.id && 'ring-2 ring-primary',
                        dragId === r.id && 'opacity-50',
                      )}
                    >
                      <CardHeader className="pb-2">
                        {/* Верхняя строка уступает место ручке перетаскивания
                            слева и кнопке «изменить» справа */}
                        <div className={cn(
                          'flex items-start justify-between gap-2 pr-9',
                          rows.length > 1 ? 'pl-6' : '',
                        )}>
                          <CardTitle className="text-base leading-snug">{r.title}</CardTitle>
                        </div>
                        {r.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">{r.description}</p>
                        )}
                      </CardHeader>
                      <CardContent className="flex items-center gap-4 text-xs text-muted-foreground pt-2">
                        <span className="flex items-center gap-1"><ListChecks className="h-3.5 w-3.5" />{r.topic_count} тем</span>
                        <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{r.student_count} учеников</span>
                      </CardContent>
                    </Card>
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!v) setOpen(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Новая программа</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="rm-title">Название</Label>
              <Input id="rm-title" value={form.title}
                onChange={(e) => setForm(p => ({ ...p, title: e.target.value }))}
                placeholder="Математика, 8 класс" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rm-subject">Предмет <span className="text-muted-foreground text-xs">(для группировки у ученика)</span></Label>
              <Input id="rm-subject" value={form.subject}
                onChange={(e) => setForm(p => ({ ...p, subject: e.target.value }))}
                placeholder="Математика" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rm-desc">Описание <span className="text-muted-foreground text-xs">(необязательно)</span></Label>
              <Input id="rm-desc" value={form.description}
                onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>Отмена</Button>
            <Button onClick={handleCreate} disabled={creating || form.title.trim().length < 2}>
              {creating ? 'Создание...' : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
