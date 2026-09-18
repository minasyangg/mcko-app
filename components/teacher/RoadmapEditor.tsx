'use client'

import { useState, useEffect } from 'react'
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
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import {
  ArrowLeft, Plus, Trash2, Pencil, Check, ChevronRight, ChevronDown as ChevronDownIcon,
  Users, Loader2, X, AlertTriangle, Search, GripVertical,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface EditorTopic {
  id: string
  title: string
  description: string | null
  sort_order: number
  parent_id: string | null
  items: { assignment_id: string; test_title: string; kind: 'homework' | 'test'; max_attempts: number; ends_at: string | null }[]
}

interface TopicNode extends EditorTopic {
  children: TopicNode[]
}

// Дерево из плоского списка — тот же приём, что buildTree в BookReader.tsx
// (components/teacher/BookReader.tsx), переиспользован без изменений логики,
// только на другом типе узла.
function buildTopicTree(topics: EditorTopic[]): TopicNode[] {
  const byId = new Map<string, TopicNode>()
  for (const t of topics) byId.set(t.id, { ...t, children: [] })
  const roots: TopicNode[] = []
  for (const t of topics) {
    const node = byId.get(t.id) as TopicNode
    if (t.parent_id && byId.has(t.parent_id)) (byId.get(t.parent_id) as TopicNode).children.push(node)
    else roots.push(node)
  }
  return roots
}
interface TestOption { id: string; title: string }
interface StudentOption { id: string; full_name: string; grade: string | null }
interface GroupOption { id: string; name: string; student_ids: string[] }
interface Roadmap { id: string; title: string; subject: string | null; description: string | null }

export function RoadmapEditor({ roadmap, topics, tests, students, memberIds, groups = [], sourceGroupIds = [] }: {
  roadmap: Roadmap
  topics: EditorTopic[]
  tests: TestOption[]
  students: StudentOption[]
  memberIds: string[]
  groups?: GroupOption[]
  /** Группы, уже зарегистрированные как «живой источник» (миграция 059) —
   *  их новые участники автоматически попадают в программу */
  sourceGroupIds?: string[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  // — Ученики —
  const [studentsOpen, setStudentsOpen] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set(memberIds))
  // Поиск по имени/классу в диалоге — при большом числе учеников прокрутка
  // max-h-72 без фильтра превращается в долгий скролл вслепую
  const [studentQuery, setStudentQuery] = useState('')
  // Уже подтверждённые сервером связи-источники (что реально в БД) — не
  // меняются кликами в диалоге, только после успешного saveStudents/unlinkGroup.
  const [linkedGroupIds, setLinkedGroupIds] = useState<Set<string>>(new Set(sourceGroupIds))
  // Группы, отмеченные «привязать» в ЭТОМ открытии диалога, но ещё не
  // сохранённые — до saveStudents() это чисто локальное состояние, поэтому
  // «Отмена» откатывает его без сети (см. resetStudentsDialog).
  const [pendingLinkGroupIds, setPendingLinkGroupIds] = useState<Set<string>>(new Set())
  const memberCount = memberIds.length

  // Добавление целой группы. API принимает только закреплённых за учителем
  // учеников (teacher_students) и отклоняет весь запрос целиком, если попался
  // чужой — поэтому фильтруем здесь, по тому же списку students, что показан
  // в диалоге. Иначе группа со «свежим» учеником, ещё не закреплённым за
  // учителем, роняла бы сохранение всего состава с 403.
  const studentIdSet = new Set(students.map(s => s.id))

  const filteredStudents = studentQuery.trim()
    ? students.filter(s => {
        const q = studentQuery.trim().toLowerCase()
        return s.full_name.toLowerCase().includes(q) || (s.grade ?? '').toLowerCase().includes(q)
      })
    : students

  // Только локально отмечает чекбоксы и помечает группу «к привязке» —
  // ничего не уходит на сервер до нажатия «Сохранить» (saveStudents), чтобы
  // «Отмена» полностью откатывала клик по группе, как и раньше.
  function addGroup(g: GroupOption) {
    const allowed = g.student_ids.filter(id => studentIdSet.has(id))
    const skipped = g.student_ids.length - allowed.length
    if (allowed.length === 0 && linkedGroupIds.has(g.id)) {
      toast.info(`Группа «${g.name}» уже привязана как источник`)
      return
    }
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
    setPendingLinkGroupIds(prev => new Set(prev).add(g.id))
    toast.success(
      added > 0 ? `Добавлено учеников: ${added}. Группа будет привязана как источник — сохраните список.` : 'Группа будет привязана как источник — сохраните список',
      skipped > 0 ? { description: `Пропущено (не ваши ученики): ${skipped}` } : undefined,
    )
  }

  // Отвязка уже сохранённой связи — самостоятельное действие, вне
  //«Сохранить»/«Отмена»: участников не убирает, только останавливает приток.
  async function unlinkGroup(g: GroupOption) {
    setBusy(true)
    try {
      const res = await fetch(`/api/roadmaps/${roadmap.id}/source-groups?group_id=${g.id}`, { method: 'DELETE' })
      if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(j.error ?? 'Ошибка'); return }
      setLinkedGroupIds(prev => { const n = new Set(prev); n.delete(g.id); return n })
      toast.success(`Группа «${g.name}» отвязана — уже добавленные ученики остаются в программе`)
    } finally { setBusy(false) }
  }

  // Полный откат диалога («Отмена» или закрытие) — оба набора возвращаются к
  // тому, что реально сохранено на сервере, без единого сетевого запроса.
  function resetStudentsDialog() {
    setChecked(new Set(memberIds))
    setPendingLinkGroupIds(new Set())
    setStudentQuery('')
    setStudentsOpen(false)
  }

  // Сохраняет список учеников И регистрирует все группы, отмеченные в этом
  // открытии диалога, как живые источники — одним действием «Сохранить», а не
  // отдельным запросом на каждый клик по группе (иначе «Отмена» не могла бы
  // ничего откатить, см. resetStudentsDialog).
  async function saveStudents() {
    setBusy(true)
    try {
      const res = await fetch(`/api/roadmaps/${roadmap.id}/students`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: [...checked] }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка'); return }

      const toLink = [...pendingLinkGroupIds].filter(id => !linkedGroupIds.has(id))
      const failedIds = new Set<string>()
      for (const groupId of toLink) {
        const r = await fetch(`/api/roadmaps/${roadmap.id}/source-groups`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ group_id: groupId }),
        })
        if (r.ok) setLinkedGroupIds(prev => new Set(prev).add(groupId))
        else failedIds.add(groupId)
      }
      // Только успешные снимаем из «к привязке» — неудавшиеся остаются
      // отмеченными «будет привязана», иначе состояние «нужно повторить»,
      // обещанное тостом ниже, нигде не сохранялось бы и группу пришлось бы
      // искать заново методом тыка.
      setPendingLinkGroupIds(failedIds)

      if (failedIds.size > 0) {
        toast.warning(`Ученики сохранены, но ${failedIds.size} групп(у) не удалось привязать как источник — повторите позже`)
      } else {
        toast.success('Ученики программы обновлены')
      }
      setStudentsOpen(false)
      router.refresh()
    } finally { setBusy(false) }
  }

  // — Темы (дерево) —
  const [newTopic, setNewTopic] = useState('')
  const topicTree = buildTopicTree(topics)
  // Перетаскиваемый объект — тема (кладётся до/после/внутрь другой темы) или
  // ДЗ-карточка (кладётся только внутрь темы, меняя её привязку). Общий на
  // весь редактор стейт, не локальный на узел, — иначе соседние узлы не
  // узнали бы, что где-то идёт перетаскивание.
  const [drag, setDrag] = useState<{ id: string; kind: 'topic' | 'item' } | null>(null)

  // parentId=null — новая тема верхнего уровня (как раньше, инпут внизу
  // страницы); иначе — дочерняя тема/деталь под конкретным узлом дерева
  // (кнопка «+ подтема» на каждом узле, см. TopicTreeItem).
  async function addTopicUnder(parentId: string | null, title: string) {
    if (title.trim().length < 1) return
    setBusy(true)
    try {
      const res = await fetch(`/api/roadmaps/${roadmap.id}/topics`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), parent_id: parentId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка'); return }
      router.refresh()
    } finally { setBusy(false) }
  }

  async function renameTopic(topicId: string, title: string) {
    const res = await fetch(`/api/roadmaps/${roadmap.id}/topics/${topicId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(json.error ?? 'Ошибка сохранения'); return false }
    router.refresh()
    return true
  }

  async function deleteTopic(topicId: string) {
    const res = await fetch(`/api/roadmaps/${roadmap.id}/topics/${topicId}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(json.error ?? 'Ошибка'); return false }
    toast.success(
      json.deleted_topics > 1 ? `Удалено тем: ${json.deleted_topics} (тема и её подтемы)` : 'Тема удалена'
    )
    router.refresh()
    return true
  }

  // Перетаскивание узла (HTML5 DnD, только десктоп — см. TopicTreeItem):
  // newParentId — куда переносим (null — корень уровня), orderedIds — полный
  // порядок id внутри ЭТОГО уровня после переноса, включая сам movedId.
  // Один запрос проставляет и parent_id перемещённого узла, и sort_order
  // всем siblings уровня — см. app/api/roadmaps/[id]/topics/reorder/route.ts.
  async function moveTopic(movedId: string, newParentId: string | null, orderedIds: string[]) {
    const res = await fetch(`/api/roadmaps/${roadmap.id}/topics/reorder`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moved_id: movedId, new_parent_id: newParentId, ordered_ids: orderedIds }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(json.error ?? 'Не удалось переместить тему'); router.refresh(); return }
    router.refresh()
  }

  // Собирает целевой уровень и решает, куда именно попадает перетаскиваемый
  // узел, и зовёт moveTopic. mode: 'before'/'after' — переставить рядом с
  // targetId в его же родителе, 'inside' — стать последним ребёнком targetId.
  function handleTopicDrop(draggedId: string, targetId: string, mode: 'before' | 'after' | 'inside') {
    if (draggedId === targetId) return
    const target = topics.find(t => t.id === targetId)
    if (!target) return

    const newParentId = mode === 'inside' ? targetId : target.parent_id
    // Нельзя перетащить узел в собственное поддерево — сервер тоже проверяет
    // это (409), но локально стоит не отправлять заведомо неверный запрос.
    const draggedSubtree = new Set<string>([draggedId])
    let grew = true
    while (grew) {
      grew = false
      for (const t of topics) {
        if (t.parent_id && draggedSubtree.has(t.parent_id) && !draggedSubtree.has(t.id)) {
          draggedSubtree.add(t.id); grew = true
        }
      }
    }
    if (draggedSubtree.has(newParentId ?? '')) return

    const siblingIds = topics
      .filter(t => t.id !== draggedId && (t.parent_id ?? null) === (newParentId ?? null))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(t => t.id)

    let orderedIds: string[]
    if (mode === 'inside') {
      orderedIds = [...siblingIds, draggedId]
    } else {
      const idx = siblingIds.indexOf(targetId)
      const insertAt = mode === 'before' ? idx : idx + 1
      orderedIds = [...siblingIds.slice(0, insertAt), draggedId, ...siblingIds.slice(insertAt)]
    }
    moveTopic(draggedId, newParentId, orderedIds)
  }

  // Перенос уже привязанного ДЗ/теста в другую тему (drag-and-drop карточки
  // задания на узел темы). Меняет только assignments.roadmap_topic_id —
  // попытки учеников привязаны к assignment_id, не к теме, поэтому результаты
  // не затрагиваются. См. app/api/roadmaps/[id]/assignments/[assignmentId]/topic.
  async function moveItemToTopic(assignmentId: string, topicId: string) {
    const res = await fetch(`/api/roadmaps/${roadmap.id}/assignments/${assignmentId}/topic`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic_id: topicId }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(json.error ?? 'Не удалось перенести задание'); return }
    toast.success('Задание перенесено в другую тему')
    router.refresh()
  }

  // — Привязка задания к теме —
  const [itemTopic, setItemTopic] = useState<EditorTopic | null>(null)
  const [itemForm, setItemForm] = useState({ test_id: '', kind: 'homework' as 'homework' | 'test', max_attempts: 1, ends_at: '' })

  // Сверка повторов при привязке теста к теме — тот же механизм и те же
  // пороги, что на экране «Назначить тест» (см. /api/assignments/duplicates).
  // Адресаты здесь — все ученики программы (memberIds), т.к. привязка теста
  // к теме назначает его сразу всем; is_group=true включает пороговый режим
  // (>50% учеников с пересечением >30% задач) — поштучный список по каждому
  // ученику здесь не показываем (в отличие от одиночного назначения): у
  // программы адресатов обычно много, а решение уже агрегировано сервером.
  const [itemGroupWarning, setItemGroupWarning] = useState<
    { affected_students: number; total_students: number; avg_overlap_percent: number } | null
  >(null)

  function openItem(topic: EditorTopic) {
    setItemTopic(topic)
    setItemForm({ test_id: '', kind: 'homework', max_attempts: 1, ends_at: '' })
    setItemGroupWarning(null)
  }

  useEffect(() => {
    // Не запрашиваем и НЕ трогаем состояние сразу в теле эффекта здесь: форма
    // и так стартует с test_id: '' при каждом openItem(), поэтому предыдущее
    // предупреждение само не переживёт открытие диалога для другой темы —
    // достаточно просто не делать запрос, когда сравнивать ещё не с чем.
    if (!itemTopic || !itemForm.test_id || memberIds.length === 0) return
    let cancelled = false
    fetch('/api/assignments/duplicates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test_id: itemForm.test_id, student_ids: memberIds, is_group: true }),
    })
      .then(r => r.ok ? r.json() : { group_warning: null })
      .then(d => { if (!cancelled) setItemGroupWarning(d.group_warning ?? null) })
      .catch(() => { if (!cancelled) setItemGroupWarning(null) })
    return () => { cancelled = true }
  }, [itemTopic, itemForm.test_id, memberIds])

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

      {/* Темы — дерево (глава → подтема → деталь), любой узел можно
          переименовать, удалить (с поддеревом) или дополнить дочерней темой
          и заданиями. */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Темы и задания</h2>

        {topics.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">Добавьте первую тему ниже.</p>
        )}

        <div className="rounded-md border divide-y">
          {topicTree.map(node => (
            <TopicTreeItem
              key={node.id} node={node} depth={0} roadmapId={roadmap.id} busy={busy}
              onRename={renameTopic} onDelete={deleteTopic} onAddChild={addTopicUnder}
              onOpenItem={openItem} onRemoveItem={removeItem}
              onDropTopic={handleTopicDrop} onMoveItem={moveItemToTopic} drag={drag} setDrag={setDrag}
            />
          ))}
        </div>
        {topics.length > 1 && (
          <p className="text-xs text-muted-foreground">
            Перетащите тему или задание за <GripVertical className="inline h-3 w-3 align-text-bottom" /> — наведите
            на верх или низ другой темы, чтобы переставить рядом с ней (появится синяя полоска), или точно на
            середину, чтобы сделать подтемой (строка подсветится целиком и появится подпись «станет подтемой»).
            Задание — на любую тему, чтобы перенести его туда.
          </p>
        )}

        {/* Добавить тему верхнего уровня */}
        <div className="flex items-center gap-2 pt-1">
          <Input value={newTopic} onChange={(e) => setNewTopic(e.target.value)}
            placeholder="Название новой темы верхнего уровня"
            onKeyDown={(e) => { if (e.key === 'Enter') { addTopicUnder(null, newTopic); setNewTopic('') } }} />
          <Button onClick={() => { addTopicUnder(null, newTopic); setNewTopic('') }} disabled={busy || newTopic.trim().length < 1}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" />Тема</>}
          </Button>
        </div>
      </div>

      {/* Диалог состава учеников */}
      <Dialog open={studentsOpen} onOpenChange={(v) => { if (!v) resetStudentsDialog() }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Ученики программы</DialogTitle></DialogHeader>

          {/* Добавление целой группы: отмечает всех её учеников в списке ниже
              и помечает группу «к привязке» — саму связь-источник создаёт
              только «Сохранить» (saveStudents), а не этот клик, поэтому
              «Отмена» полностью откатывает выбор без сетевых следов.
              Уже сохранённые связи показаны отдельно и их можно отвязать
              сразу, не дожидаясь общего «Сохранить». */}
          {groups.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Добавить группу целиком</p>
              <div className="flex flex-wrap gap-1.5">
                {groups.map(g => {
                  const linked = linkedGroupIds.has(g.id)
                  const pending = pendingLinkGroupIds.has(g.id)
                  return linked ? (
                    <Badge key={g.id} variant="secondary" className="h-7 text-xs gap-1 pr-1">
                      <Users className="h-3 w-3" />
                      {g.name}
                      <span className="text-muted-foreground">({g.student_ids.length})</span>
                      <button
                        type="button"
                        title="Отвязать группу от программы"
                        onClick={() => unlinkGroup(g)}
                        disabled={busy}
                        className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ) : (
                    <Button
                      key={g.id}
                      type="button"
                      variant={pending ? 'secondary' : 'outline'}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => addGroup(g)}
                      disabled={busy || g.student_ids.length === 0}
                    >
                      <Users className="h-3 w-3 mr-1" />
                      {g.name}
                      <span className="ml-1 text-muted-foreground">({g.student_ids.length})</span>
                      {pending && <span className="ml-1 text-[10px]">· будет привязана</span>}
                    </Button>
                  )
                })}
              </div>
              {(linkedGroupIds.size > 0 || pendingLinkGroupIds.size > 0) && (
                <p className="text-[11px] text-muted-foreground">
                  Привязанные группы автоматически добавляют в программу новых учеников
                  {pendingLinkGroupIds.size > 0 ? ' (отмеченные «будет привязана» — после «Сохранить»)' : ''}.
                </p>
              )}
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

          {students.length > 8 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
                placeholder="Поиск по имени или классу..."
                className="pl-8 h-8 text-sm"
              />
            </div>
          )}

          <div className="space-y-1 max-h-72 overflow-y-auto rounded-md border divide-y">
            {students.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">За вами не закреплено учеников</p>
            )}
            {students.length > 0 && filteredStudents.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Ничего не найдено</p>
            )}
            {filteredStudents.map(s => (
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
              <SearchableSelect
                options={tests.map(t => ({ value: t.id, label: t.title }))}
                value={itemForm.test_id}
                onChange={(v) => setItemForm(p => ({ ...p, test_id: v }))}
                placeholder="Выберите свой опубликованный тест"
                recentLabel="Недавно созданные"
                emptyText="Нет опубликованных тестов"
              />
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

            {/* Мягкое предупреждение, не блокирует привязку — повтор задачи
                для закрепления может быть осознанным решением учителя. */}
            {itemGroupWarning && (
              <div className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0 text-amber-900 dark:text-amber-200">
                  <div className="font-medium">Похоже, это ДЗ во многом повторяет уже заданное</div>
                  <p className="mt-1 text-amber-800/90 dark:text-amber-200/80">
                    У {itemGroupWarning.affected_students} из {itemGroupWarning.total_students} учеников
                    программы в среднем {itemGroupWarning.avg_overlap_percent}% задач этого теста уже
                    встречались в других заданиях.
                  </p>
                </div>
              </div>
            )}
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

// ─── Узел дерева тем ────────────────────────────────────────────────────────

interface DeletePreview {
  title: string
  topics_count: number
  assignments_count: number
  submitted_attempts_count: number
  blocked: boolean
}

// Один узел дерева тем — по образцу TocItem (components/teacher/BookReader.tsx):
// inline-переименование (Pencil→Input→Check/X), удаление с серверным превью
// (GET перед показом диалога) и жёсткой блокировкой, если у поддерева есть
// сданные попытки — см. app/api/roadmaps/[id]/topics/[topicId]/route.ts.
type DropMode = 'before' | 'after' | 'inside'

type DragState = { id: string; kind: 'topic' | 'item' } | null

function TopicTreeItem({
  node, depth, roadmapId, busy, onRename, onDelete, onAddChild, onOpenItem, onRemoveItem,
  onDropTopic, onMoveItem, drag, setDrag,
}: {
  node: TopicNode
  depth: number
  roadmapId: string
  busy: boolean
  onRename: (topicId: string, title: string) => Promise<boolean>
  onDelete: (topicId: string) => Promise<boolean>
  onAddChild: (parentId: string | null, title: string) => Promise<void>
  onOpenItem: (topic: EditorTopic) => void
  onRemoveItem: (topicId: string, assignmentId: string) => void
  onDropTopic: (draggedId: string, targetId: string, mode: DropMode) => void
  onMoveItem: (assignmentId: string, topicId: string) => void
  drag: DragState
  setDrag: (d: DragState) => void
}) {
  const [open, setOpen] = useState(depth < 1)
  const hasChildren = node.children.length > 0

  // Зона наведения при перетаскивании темы над ЭТИМ узлом — верх/низ строки
  // переставляет рядом (тот же родитель), середина — делает подтемой.
  // Десктоп-only (HTML5 DnD API, без обработки touch-жестов). Перетаскивание
  // ДЗ-карточки (drag.kind === 'item') не различает зоны — задание всегда
  // просто переносится «в» эту тему, поэтому у него своя, более простая
  // подсветка (isItemDropTarget) без before/after.
  const [dropZone, setDropZone] = useState<DropMode | null>(null)
  const [isItemDropTarget, setIsItemDropTarget] = useState(false)
  const isDragSource = drag?.kind === 'topic' && drag.id === node.id

  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState(node.title)
  const [savingTitle, setSavingTitle] = useState(false)

  const [addingChild, setAddingChild] = useState(false)
  const [childDraft, setChildDraft] = useState('')

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [preview, setPreview] = useState<DeletePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleSaveTitle() {
    const title = titleDraft.trim()
    if (!title) { toast.error('Название не может быть пустым'); return }
    if (title === node.title) { setRenaming(false); return }
    setSavingTitle(true)
    try {
      const ok = await onRename(node.id, title)
      if (ok) setRenaming(false)
    } finally {
      setSavingTitle(false)
    }
  }

  async function handleAddChild() {
    if (childDraft.trim().length < 1) return
    await onAddChild(node.id, childDraft)
    setChildDraft('')
    setAddingChild(false)
    setOpen(true)
  }

  async function openDelete() {
    setDeleteOpen(true)
    setPreview(null)
    setPreviewLoading(true)
    try {
      const res = await fetch(`/api/roadmaps/${roadmapId}/topics/${node.id}`)
      if (res.ok) setPreview(await res.json())
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const ok = await onDelete(node.id)
      if (ok) setDeleteOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className="relative"
      onDragOver={(e) => {
        if (!drag || (drag.kind === 'topic' && drag.id === node.id)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (drag.kind === 'item') { setIsItemDropTarget(true); return }
        const rect = e.currentTarget.getBoundingClientRect()
        const ratio = (e.clientY - rect.top) / rect.height
        // Верх/низ — по 40% высоты каждая (переставить рядом, самое частое
        // действие — щедрая зона, легко попасть). Середина — только 20%,
        // узко и намеренно: «сделать подтемой» меняет структуру сильнее
        // всего, случайное попадание сюда при простой перестановке — самая
        // частая жалоба на нынешнюю версию (пороги были по 25%/50%/25%).
        setDropZone(ratio < 0.4 ? 'before' : ratio > 0.6 ? 'after' : 'inside')
      }}
      onDragLeave={(e) => {
        // Игнорируем переходы между дочерними элементами внутри той же строки —
        // иначе индикатор мигает при каждом пикселе движения курсора.
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDropZone(null)
        setIsItemDropTarget(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        if (drag?.kind === 'item') onMoveItem(drag.id, node.id)
        else if (drag && drag.id !== node.id && dropZone) onDropTopic(drag.id, node.id, dropZone)
        setDropZone(null)
        setIsItemDropTarget(false)
      }}
    >
      {/* Индикатор вставки — толстая полоса на том же отступе глубины, что и
          сама строка: показывает буквально, где появится тема после drop, а
          не просто «где-то у края». Раньше была линия 0.5px без отступа —
          на плотном списке терялась и не показывала, на каком уровне
          вложенности встанет тема. */}
      {dropZone === 'before' && (
        <div className="absolute right-0 top-0 h-1 bg-primary rounded-full z-10" style={{ left: `${12 + depth * 18}px` }} />
      )}
      {dropZone === 'after' && (
        <div className="absolute right-0 bottom-0 h-1 bg-primary rounded-full z-10" style={{ left: `${12 + depth * 18}px` }} />
      )}
      <div
        className={cn(
          'group flex items-start gap-1.5 px-3 py-2 transition-colors',
          isDragSource && 'opacity-40',
          (dropZone === 'inside' || isItemDropTarget) && 'bg-primary/10 ring-2 ring-inset ring-primary',
        )}
        style={{ paddingLeft: `${12 + depth * 18}px` }}
      >
        <span
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', node.id)
            setDrag({ id: node.id, kind: 'topic' })
          }}
          onDragEnd={() => { setDrag(null); setDropZone(null) }}
          className="mt-0.5 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          title="Перетащите: край темы — переставить рядом, середина — сделать подтемой"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        {hasChildren ? (
          <button type="button" onClick={() => setOpen(!open)} className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground">
            {open ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          {renaming ? (
            <div className="flex items-center gap-1">
              <Input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTitle()
                  if (e.key === 'Escape') { setTitleDraft(node.title); setRenaming(false) }
                }}
                autoFocus
                disabled={savingTitle}
                className="h-7 text-sm"
              />
              <button type="button" onClick={handleSaveTitle} disabled={savingTitle} title="Сохранить" className="text-green-600 hover:text-green-700 shrink-0">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => { setTitleDraft(node.title); setRenaming(false) }} disabled={savingTitle} title="Отмена" className="text-muted-foreground hover:text-foreground shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className={cn('truncate', depth === 0 ? 'font-medium' : 'text-sm')}>{node.title}</span>
              {/* Явно проговаривает намерение drop вместо того, чтобы пользователь
                  угадывал по подсветке фона/толщине полоски — прямая причина
                  жалобы «не всегда понятно куда встанет тема». */}
              {dropZone === 'inside' && drag?.kind === 'topic' && (
                <span className="text-xs font-medium text-primary shrink-0">→ станет подтемой</span>
              )}
              {isItemDropTarget && (
                <span className="text-xs font-medium text-primary shrink-0">→ задание переедет сюда</span>
              )}
              <span className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button type="button" onClick={() => setRenaming(true)} title="Переименовать" className="text-muted-foreground hover:text-foreground">
                  <Pencil className="h-3 w-3" />
                </button>
                <button type="button" onClick={() => setAddingChild(true)} title="Добавить подтему" className="text-muted-foreground hover:text-foreground">
                  <Plus className="h-3 w-3" />
                </button>
                <button type="button" onClick={openDelete} title="Удалить тему (и подтемы)" className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            </div>
          )}

          {addingChild && (
            <div className="flex items-center gap-1 mt-1.5">
              <Input
                value={childDraft}
                onChange={(e) => setChildDraft(e.target.value)}
                placeholder="Название подтемы"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddChild()
                  if (e.key === 'Escape') { setChildDraft(''); setAddingChild(false) }
                }}
                autoFocus
                className="h-7 text-sm"
              />
              <Button size="sm" className="h-7" onClick={handleAddChild} disabled={busy || childDraft.trim().length < 1}>Добавить</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => { setChildDraft(''); setAddingChild(false) }}>Отмена</Button>
            </div>
          )}

          {/* Задания привязаны к конкретному узлу — на любом уровне дерева,
              не только листовом (учитель может назначить тест сразу на
              главу целиком, минуя подтемы). Перетаскиваются на другую тему —
              меняет только roadmap_topic_id (см. onMoveItem), результаты
              учеников не затрагиваются. */}
          {node.items.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {node.items.map(it => (
                <div
                  key={it.assignment_id}
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation()
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', it.assignment_id)
                    setDrag({ id: it.assignment_id, kind: 'item' })
                  }}
                  onDragEnd={() => setDrag(null)}
                  className={cn(
                    'flex items-center gap-2 text-sm cursor-grab active:cursor-grabbing rounded px-1 -mx-1',
                    drag?.kind === 'item' && drag.id === it.assignment_id && 'opacity-40',
                  )}
                >
                  <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                  <Badge variant={it.kind === 'homework' ? 'outline' : 'secondary'} className="text-[11px] shrink-0">
                    {it.kind === 'homework' ? 'ДЗ' : 'Тест'}
                  </Badge>
                  <span className="flex-1 truncate">{it.test_title}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{it.max_attempts} поп.</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={() => onRemoveItem(node.id, it.assignment_id)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Button variant="ghost" size="sm" className="h-6 mt-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onOpenItem(node)}>
            <Plus className="h-3 w-3 mr-1" /> Добавить задание
          </Button>
        </div>
      </div>

      {open && hasChildren && (
        <div className="divide-y border-t">
          {node.children.map(child => (
            <TopicTreeItem
              key={child.id} node={child} depth={depth + 1} roadmapId={roadmapId} busy={busy}
              onRename={onRename} onDelete={onDelete} onAddChild={onAddChild}
              onOpenItem={onOpenItem} onRemoveItem={onRemoveItem}
              onDropTopic={onDropTopic} onMoveItem={onMoveItem} drag={drag} setDrag={setDrag}
            />
          ))}
        </div>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={(v) => { if (!v) setDeleteOpen(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <AlertTriangle />
            </AlertDialogMedia>
            <AlertDialogTitle>Удалить «{node.title}»?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <span className="block">
                {previewLoading ? (
                  'Проверяю содержимое темы...'
                ) : preview ? (
                  preview.blocked ? (
                    <span className="block font-medium text-destructive">
                      Удаление запрещено: у темы или её подтем есть {preview.submitted_attempts_count} сданных
                      учениками работ. Результаты учеников не удаляются автоматически — отвяжите
                      завершённые задания вручную, если это осознанное решение.
                    </span>
                  ) : (
                    <>
                      Будет удалено {preview.topics_count} тем{preview.topics_count > 1 ? ' (включая подтемы)' : ''}
                      {preview.assignments_count > 0 ? ` и ${preview.assignments_count} привязанных заданий` : ''}, безвозвратно.
                    </>
                  )
                ) : (
                  'Не удалось получить информацию о теме.'
                )}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || previewLoading || !preview || preview.blocked}
            >
              {deleting ? 'Удаление...' : 'Удалить'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
