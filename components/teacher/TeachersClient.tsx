'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Users, Search, LayoutDashboard } from 'lucide-react'

interface TeacherRow {
  id: string
  full_name: string
  email: string
  is_active: boolean | null
  student_count: number
}
interface StudentRow {
  id: string
  full_name: string
  grade: string | null
  teacher_ids: string[]   // прикреплённые учителя (M:N)
  is_active: boolean | null
}

// Таблица учителей + диалог множественного закрепления учеников.
// Создание учителя вынесено в общий диалог «Создать пользователя» (UsersClient).
export function TeachersClient({ teachers, students }: { teachers: TeacherRow[]; students: StudentRow[] }) {
  const router = useRouter()

  // ── Закрепление учеников ──
  const teacherNameById = useMemo(
    () => new Map(teachers.map(t => [t.id, t.full_name])),
    [teachers],
  )
  const [assignTarget, setAssignTarget] = useState<TeacherRow | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [savingAssign, setSavingAssign] = useState(false)

  function openAssign(t: TeacherRow) {
    setAssignTarget(t)
    setQuery('')
    setChecked(new Set(students.filter(s => s.teacher_ids.includes(t.id)).map(s => s.id)))
  }

  const filteredStudents = useMemo(() => {
    const q = query.trim().toLowerCase()
    const visible = students.filter(s => s.is_active !== false)
    if (!q) return visible
    return visible.filter(s => s.full_name.toLowerCase().includes(q) || (s.grade ?? '').toLowerCase().includes(q))
  }, [students, query])

  function toggle(id: string) {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleAssignSave() {
    if (!assignTarget) return
    const tid = assignTarget.id
    const toAssign = students.filter(s => checked.has(s.id) && !s.teacher_ids.includes(tid)).map(s => s.id)
    const toUnassign = students.filter(s => !checked.has(s.id) && s.teacher_ids.includes(tid)).map(s => s.id)
    if (toAssign.length === 0 && toUnassign.length === 0) { setAssignTarget(null); return }

    setSavingAssign(true)
    try {
      for (const [action, ids] of [['assign', toAssign], ['unassign', toUnassign]] as const) {
        if (ids.length === 0) continue
        const res = await fetch(`/api/admin/teachers/${tid}/students`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, student_ids: ids }),
        })
        const json = await res.json()
        if (!res.ok) { toast.error(json.error ?? 'Ошибка закрепления'); return }
      }
      toast.success(
        `Закреплено: +${toAssign.length}${toUnassign.length ? `, откреплено: ${toUnassign.length}` : ''}`,
      )
      setAssignTarget(null)
      router.refresh()
    } finally {
      setSavingAssign(false)
    }
  }

  return (
    <>
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">ФИО</th>
              <th className="text-left px-4 py-3 font-medium">Email</th>
              <th className="text-left px-4 py-3 font-medium">Учеников</th>
              <th className="px-4 py-3 w-60" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {teachers.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                Учителей пока нет.
              </td></tr>
            )}
            {teachers.map(t => (
              <tr key={t.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium">{t.full_name}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{t.email || '—'}</td>
                <td className="px-4 py-3">
                  <Badge variant="secondary">{t.student_count}</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/teacher/users/${t.id}/cabinet`}>
                        <LayoutDashboard className="h-3.5 w-3.5 mr-1.5" />
                        Кабинет
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openAssign(t)}>
                      <Users className="h-3.5 w-3.5 mr-1.5" />
                      Ученики
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Закрепление учеников */}
      <Dialog open={!!assignTarget} onOpenChange={(v) => { if (!v) setAssignTarget(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ученики: {assignTarget?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по имени или классу..." className="pl-8 h-9" />
            </div>
            <p className="text-xs text-muted-foreground">
              Отмечено: {checked.size}. Снятие галочки открепляет ученика от этого учителя.
            </p>
            <div className="max-h-80 overflow-y-auto rounded-md border divide-y">
              {filteredStudents.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Ничего не найдено</p>
              )}
              {filteredStudents.map(s => {
                const others = s.teacher_ids
                  .filter(id => id !== assignTarget?.id)
                  .map(id => teacherNameById.get(id))
                  .filter(Boolean)
                const otherTeacher = others.length ? others.join(', ') : null
                return (
                  <label key={s.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40">
                    <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggle(s.id)}
                      className="h-4 w-4 shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="text-sm">{s.full_name}</span>
                      {s.grade && <span className="text-xs text-muted-foreground ml-2">{s.grade}</span>}
                    </span>
                    {otherTeacher && (
                      <span className="text-[11px] text-amber-600 shrink-0">закреплён: {otherTeacher}</span>
                    )}
                  </label>
                )
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTarget(null)} disabled={savingAssign}>Отмена</Button>
            <Button onClick={handleAssignSave} disabled={savingAssign}>
              {savingAssign ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
