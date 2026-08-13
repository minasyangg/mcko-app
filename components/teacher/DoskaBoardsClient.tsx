'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Plus, PenLine, Link2, Trash2 } from 'lucide-react'
import { DOSKA_SUBJECTS } from '@/lib/doska/subjects'

export interface BoardRow {
  id: string
  title: string
  subject: string | null
  updatedAt: string | null
  students: string[]
  group: string | null
}
interface Props {
  boards: BoardRow[]
  students: { id: string; full_name: string | null }[]
  groups: { id: string; name: string; size: number }[]
}

export function DoskaBoardsClient({ boards, students, groups }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  // Доска заводится либо на одного ученика, либо на группу целиком. Это один
  // выбор, а не два независимых: иначе непонятно, что победит.
  const [mode, setMode] = useState<'student' | 'group'>('student')
  const [studentId, setStudentId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [subject, setSubject] = useState('')
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  async function handleCreate() {
    if (mode === 'student' && !studentId) return toast.error('Выберите ученика')
    if (mode === 'group' && !groupId) return toast.error('Выберите группу')
    if (!subject) return toast.error('Выберите предмет')
    setSaving(true)
    try {
      const res = await fetch('/api/teacher/doska-boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'group' ? { groupId, subject, title } : { studentId, subject, title }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Не удалось создать доску'); return }
      toast.success(json.added > 1 ? `Доска создана · учеников: ${json.added}` : 'Доска создана')
      setOpen(false); setStudentId(''); setGroupId(''); setSubject(''); setTitle('')
      router.refresh()
    } catch {
      toast.error('Не удалось создать доску')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setRemoving(id)
    try {
      const res = await fetch(`/api/teacher/doska-boards/${id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Не удалось удалить'); return }
      toast.success('Доска удалена')
      router.refresh()
    } catch {
      toast.error('Не удалось удалить')
    } finally {
      setRemoving(null)
    }
  }

  // Ссылка для ученика ведёт не на саму доску, а через /api/doska/open: там
  // проверяется, что человек тот самый, и выдаётся его собственная сессия
  // доски. Голая ссылка на полотно потребовала бы вводить пароль заново.
  async function copyLink(id: string) {
    const url = `${window.location.origin}/api/doska/open?b=${id}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Ссылка скопирована')
    } catch {
      window.prompt('Ссылка на доску:', url)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Новая доска
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Новая доска</DialogTitle>
              <DialogDescription>
                Доска общая: вы и выбранный ученик — или вся группа. Предмет отличает её
                от других досок с теми же людьми.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Кому</Label>
                <div className="flex gap-2">
                  <Button type="button" size="sm" className="flex-1"
                    variant={mode === 'student' ? 'default' : 'outline'}
                    onClick={() => setMode('student')} id="board-mode-student">
                    Одному ученику
                  </Button>
                  <Button type="button" size="sm" className="flex-1"
                    variant={mode === 'group' ? 'default' : 'outline'}
                    onClick={() => setMode('group')} id="board-mode-group"
                    disabled={!groups.length}
                    title={groups.length ? undefined : 'У вас пока нет групп с учениками'}>
                    Группе
                  </Button>
                </div>
              </div>

              {mode === 'student' ? (
                <div className="space-y-2">
                  <Label htmlFor="board-student">Ученик</Label>
                  <Select value={studentId} onValueChange={setStudentId}>
                    <SelectTrigger id="board-student">
                      <SelectValue placeholder="Выберите ученика..." />
                    </SelectTrigger>
                    <SelectContent>
                      {students.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.full_name ?? 'Без имени'}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="board-group">Группа</Label>
                  <Select value={groupId} onValueChange={setGroupId}>
                    <SelectTrigger id="board-group">
                      <SelectValue placeholder="Выберите группу..." />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name} · {g.size}{' '}
                          {g.size === 1 ? 'ученик' : g.size < 5 ? 'ученика' : 'учеников'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Доска появится в кабинете у каждого ученика группы.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="board-subject">Предмет</Label>
                <Select value={subject} onValueChange={setSubject}>
                  <SelectTrigger id="board-subject">
                    <SelectValue placeholder="Выберите предмет..." />
                  </SelectTrigger>
                  <SelectContent>
                    {DOSKA_SUBJECTS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="board-title">Название</Label>
                <Input
                  id="board-title"
                  placeholder="Можно не заполнять — соберём из ученика и предмета"
                  value={title}
                  maxLength={80}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Отмена
              </Button>
              <Button onClick={handleCreate} disabled={saving}>
                {saving ? 'Создаю…' : 'Создать'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {!boards.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3 border rounded-lg">
          <PenLine className="h-10 w-10 opacity-40" />
          <p>Досок пока нет. Заведите первую — она откроется сразу готовой к письму.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Название</th>
                <th className="text-left px-4 py-3 font-medium">Предмет</th>
                <th className="text-left px-4 py-3 font-medium">Ученики</th>
                <th className="text-left px-4 py-3 font-medium">Изменена</th>
                <th className="px-4 py-3 w-56" />
              </tr>
            </thead>
            <tbody>
              {boards.map((b) => (
                <tr key={b.id} className="border-t">
                  <td className="px-4 py-3 font-medium">{b.title}</td>
                  <td className="px-4 py-3">
                    {b.subject
                      ? <Badge variant="secondary">{b.subject}</Badge>
                      : <span className="text-xs text-muted-foreground">не указан</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {b.group ? (
                      <span title={b.students.join(', ')}>
                        <Badge variant="outline" className="mr-1.5">{b.group}</Badge>
                        {b.students.length} чел.
                      </span>
                    ) : b.students.length ? b.students.join(', ') : '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {b.updatedAt ? new Date(b.updatedAt).toLocaleDateString('ru-RU') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <Button asChild size="sm" variant="outline">
                        <a href={`/api/doska/open?b=${b.id}`} target="_blank" rel="noopener noreferrer">
                          <PenLine className="h-3.5 w-3.5 mr-1.5" />
                          Открыть
                        </a>
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0"
                        title="Скопировать ссылку для ученика" onClick={() => copyLink(b.id)}>
                        <Link2 className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0"
                            title="Удалить доску" disabled={removing === b.id}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Удалить доску «{b.title}»?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Она исчезнет и у вас, и у ученика. Написанное на ней сохранится
                              на сервере доски, но открыть его будет уже нечем.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Отмена</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(b.id)}>
                              Удалить
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
