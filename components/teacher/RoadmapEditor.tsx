'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ConfirmDeleteAction } from '@/components/shared/ConfirmDeleteAction'
import { EditRoadmapDialog } from '@/components/teacher/EditRoadmapDialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, Users, Loader2, X, GripVertical, AlertTriangle,
} from 'lucide-react'

export interface EditorTopic {
  id: string
  title: string
  description: string | null
  sort_order: number
  items: { assignment_id: string; test_title: string; kind: 'homework' | 'test'; max_attempts: number; ends_at: string | null }[]
}
interface TestOption { id: string; title: string }
interface StudentOption { id: string; full_name: string; grade: string | null }
interface GroupOption { id: string; name: string; student_ids: string[] }
interface Roadmap { id: string; title: string; subject: string | null; description: string | null }

export function RoadmapEditor({ roadmap, topics, tests, students, memberIds, groups = [] }: {
  roadmap: Roadmap
  topics: EditorTopic[]
  tests: TestOption[]
  students: StudentOption[]
  memberIds: string[]
  groups?: GroupOption[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  // — Ученики —
  const [studentsOpen, setStudentsOpen] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set(memberIds))
  const memberCount = memberIds.length

  // Добавление целой группы. API принимает только закреплённых за учителем
  // учеников (teacher_students) и отклоняет весь запрос целиком, если попался
  // чужой — поэтому фильтруем здесь, по тому же списку students, что показан
  // в диалоге. Иначе группа со «свежим» учеником, ещё не закреплённым за
  // учителем, роняла бы сохранение всего состава с 403.
  const studentIdSet = new Set(students.map(s => s.id))

  function addGroup(g: GroupOption) {
    const allowed = g.student_ids.filter(id => studentIdSet.has(id))
    const skipped = g.student_ids.length - allowed.length
    if (allowed.length === 0) {
      toast.error(skipped > 0
        ? `Ученики группы «${g.name}» не закреплены за вами`
        : `В группе «${g.name}» нет учеников`)
      return
    }
    const added = allowed.filter(id => !checked.has(id)).length
    setChecked(prev => {
      const n = new Set(prev)
      for (const id of allowed) n.add(id)
      return n
    })
    toast.success(
      added > 0 ? `Добавлено учеников: ${added}` : 'Все ученики группы уже в программе',
      skipped > 0 ? { description: `Пропущено (не ваши ученики): ${skipped}` } : undefined,
    )
  }

  async function saveStudents() {
    setBusy(true)
    try {
      const res = await fetch(`/api/roadmaps/${roadmap.id}/students`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: [...checked] }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка'); return }
      toast.success('Ученики программы обновлены')
      setStudentsOpen(false)
      router.refresh()
    } finally { setBusy(false) }
  }

  // — Темы —
  const [newTopic, setNewTopic] = useState('')
  async function addTopic() {
    if (newTopic.trim().length < 1) return
    setBusy(true)
    try {
      const res = await fetch(`/api/roadmaps/${roadmap.id}/topics`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTopic.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка'); return }
      setNewTopic('')
      router.refresh()
    } finally { setBusy(false) }
  }

  async function deleteTopic(topicId: string) {
    const res = await fetch(`/api/roadmaps/${roadmap.id}/topics/${topicId}`, { method: 'DELETE' })
    if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(j.error ?? 'Ошибка'); return }
    toast.success('Тема удалена')
    router.refresh()
  }

  async function moveTopic(index: number, dir: -1 | 1) {
    const a = topics[index]
    const b = topics[index + dir]
    if (!a || !b) return
    setBusy(true)
    try {
      await Promise.all([
        fetch(`/api/roadmaps/${roadmap.id}/topics/${a.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sort_order: b.sort_order }),
        }),
        fetch(`/api/roadmaps/${roadmap.id}/topics/${b.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sort_order: a.sort_order }),
        }),
      ])
      router.refresh()
    } finally { setBusy(false) }
  }

  // — Привязка задания к теме —
  const [itemTopic, setItemTopic] = useState<EditorTopic | null>(null)
  const [itemForm, setItemForm] = useState({ test_id: '', kind: 'homework' as 'homework' | 'test', max_attempts: 1, ends_at: '' })

  function openItem(topic: EditorTopic) {
    setItemTopic(topic)
    setItemForm({ test_id: '', kind: 'homework', max_attempts: 1, ends_at: '' })
  }

  async function addItem() {
    if (!itemTopic || !itemForm.test_id) return
    setBusy(true)
    try {
      const res = await fetch(`/api/roadmaps/${roadmap.id}/topics/${itemTopic.id}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test_id: itemForm.test_id, kind: itemForm.kind,
          max_attempts: itemForm.max_attempts, ends_at: itemForm.ends_at || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка'); return }
      toast.success('Задание привязано')
      setItemTopic(null)
      router.refresh()
    } finally { setBusy(false) }
  }

  async function removeItem(topicId: string, assignmentId: string) {
    const res = await fetch(`/api/roadmaps/${roadmap.id}/topics/${topicId}/items?assignment_id=${assignmentId}`, { method: 'DELETE' })
    if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(j.error ?? 'Ошибка'); return }
    toast.success('Задание отвязано')
    router.refresh()
  }

  // — Удаление программы —
  async function deleteRoadmap() {
    const res = await fetch(`/api/roadmaps/${roadmap.id}`, { method: 'DELETE' })
    if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(j.error ?? 'Ошибка'); return }
    toast.success('Программа удалена')
    router.push('/teacher/roadmaps')
    router.refresh()
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <Button asChild variant="ghost" size="sm" className="h-7 -ml-2 px-2 text-muted-foreground">
            <Link href="/teacher/roadmaps"><ArrowLeft className="h-3.5 w-3.5 mr-1" /> Все программы</Link>
          </Button>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{roadmap.title}</h1>
            {roadmap.subject && <Badge variant="secondary">{roadmap.subject}</Badge>}
          </div>
          {roadmap.description && <p className="text-sm text-muted-foreground">{roadmap.description}</p>}
        </div>
        <div className="flex items-center gap-2">
        <EditRoadmapDialog
          roadmapId={roadmap.id}
          title={roadmap.title}
          subject={roadmap.subject}
          description={roadmap.description}
          variant="button"
        />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
              <Trash2 className="h-4 w-4 mr-1.5" /> Удалить
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia className="bg-destructive/10 text-destructive">
                <AlertTriangle />
              </AlertDialogMedia>
              <AlertDialogTitle>Удалить программу «{roadmap.title}»?</AlertDialogTitle>
              <AlertDialogDescription>
                Программа, её темы и все привязанные к темам назначения (вместе с попытками
                учеников) будут удалены безвозвратно.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <ConfirmDeleteAction onConfirm={deleteRoadmap} />
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        </div>
      </div>

      {/* Ученики программы */}
      <div className="flex items-center justify-between rounded-md border px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span>Учеников в программе: <b>{memberCount}</b></span>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setChecked(new Set(memberIds)); setStudentsOpen(true) }}>
          Изменить состав
        </Button>
      </div>

      {/* Темы */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Темы и задания</h2>

        {topics.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">Добавьте первую тему ниже.</p>
        )}

        {topics.map((t, i) => (
          <div key={t.id} className="rounded-md border">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b bg-muted/30">
              <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-medium flex-1 truncate">{i + 1}. {t.title}</span>
              <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0 || busy} onClick={() => moveTopic(i, -1)}>
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === topics.length - 1 || busy} onClick={() => moveTopic(i, 1)}>
                <ChevronDown className="h-4 w-4" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogMedia className="bg-destructive/10 text-destructive">
                      <AlertTriangle />
                    </AlertDialogMedia>
                    <AlertDialogTitle>Удалить тему «{t.title}»?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Привязанные к теме задания (и попытки учеников по ним) будут удалены.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                    <ConfirmDeleteAction onConfirm={() => deleteTopic(t.id)} />
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            <div className="px-3 py-2 space-y-1.5">
              {t.items.length === 0 ? (
                <p className="text-xs text-muted-foreground">Заданий пока нет</p>
              ) : (
                t.items.map(it => (
                  <div key={it.assignment_id} className="flex items-center gap-2 text-sm">
                    <Badge variant={it.kind === 'homework' ? 'outline' : 'secondary'} className="text-[11px] shrink-0">
                      {it.kind === 'homework' ? 'ДЗ' : 'Тест'}
                    </Badge>
                    <span className="flex-1 truncate">{it.test_title}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{it.max_attempts} поп.</span>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => removeItem(t.id, it.assignment_id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))
              )}
              <Button variant="ghost" size="sm" className="h-7 mt-1 text-xs" onClick={() => openItem(t)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Добавить задание
              </Button>
            </div>
          </div>
        ))}

        {/* Добавить тему */}
        <div className="flex items-center gap-2 pt-1">
          <Input value={newTopic} onChange={(e) => setNewTopic(e.target.value)}
            placeholder="Название новой темы"
            onKeyDown={(e) => { if (e.key === 'Enter') addTopic() }} />
          <Button onClick={addTopic} disabled={busy || newTopic.trim().length < 1}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" />Тема</>}
          </Button>
        </div>
      </div>

      {/* Диалог состава учеников */}
      <Dialog open={studentsOpen} onOpenChange={(v) => { if (!v) setStudentsOpen(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Ученики программы</DialogTitle></DialogHeader>

          {/* Добавление целой группы: отмечает всех её учеников в списке ниже.
              Состав программы остаётся списком учеников — группа лишь способ
              отметить их разом, поэтому дальше её можно свободно править. */}
          {groups.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Добавить группу целиком</p>
              <div className="flex flex-wrap gap-1.5">
                {groups.map(g => (
                  <Button
                    key={g.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => addGroup(g)}
                    disabled={busy || g.student_ids.length === 0}
                  >
                    <Users className="h-3 w-3 mr-1" />
                    {g.name}
                    <span className="ml-1 text-muted-foreground">({g.student_ids.length})</span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Выбрано: <b className="text-foreground">{checked.size}</b></span>
            {checked.size > 0 && (
              <button type="button" onClick={() => setChecked(new Set())}
                className="underline underline-offset-2 hover:text-foreground">
                Снять все
              </button>
            )}
          </div>

          <div className="space-y-1 max-h-72 overflow-y-auto rounded-md border divide-y">
            {students.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">За вами не закреплено учеников</p>
            )}
            {students.map(s => (
              <label key={s.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40">
                <input type="checkbox" className="h-4 w-4 shrink-0" checked={checked.has(s.id)}
                  onChange={() => setChecked(prev => {
                    const n = new Set(prev); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n
                  })} />
                <span className="text-sm">{s.full_name}{s.grade ? ` (${s.grade})` : ''}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStudentsOpen(false)} disabled={busy}>Отмена</Button>
            <Button onClick={saveStudents} disabled={busy}>{busy ? 'Сохранение...' : 'Сохранить'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог привязки задания */}
      <Dialog open={!!itemTopic} onOpenChange={(v) => { if (!v) setItemTopic(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Задание к теме «{itemTopic?.title}»</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Тест</Label>
              <Select value={itemForm.test_id || undefined} onValueChange={(v) => setItemForm(p => ({ ...p, test_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Выберите свой опубликованный тест" /></SelectTrigger>
                <SelectContent>
                  {tests.length === 0
                    ? <SelectItem value="_none" disabled>Нет опубликованных тестов</SelectItem>
                    : tests.map(t => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Тип</Label>
              <Select value={itemForm.kind} onValueChange={(v) => setItemForm(p => ({ ...p, kind: v as 'homework' | 'test' }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="homework">Домашнее задание</SelectItem>
                  <SelectItem value="test">Тест / контрольная</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="it-att">Попыток</Label>
                <Input id="it-att" type="number" min={1} value={itemForm.max_attempts}
                  onChange={(e) => setItemForm(p => ({ ...p, max_attempts: Math.max(1, Number(e.target.value) || 1) }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="it-end">Срок до</Label>
                <Input id="it-end" type="datetime-local" value={itemForm.ends_at}
                  onChange={(e) => setItemForm(p => ({ ...p, ends_at: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemTopic(null)} disabled={busy}>Отмена</Button>
            <Button onClick={addItem} disabled={busy || !itemForm.test_id}>{busy ? 'Сохранение...' : 'Привязать'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
