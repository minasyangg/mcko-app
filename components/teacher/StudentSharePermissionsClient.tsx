'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronDown, ChevronRight, User, Loader2 } from 'lucide-react'

interface StudentRow {
  id: string
  full_name: string
  grade: string | null
  enabled: boolean
  default_ttl_days: number
  recipient_ids: string[]
}
interface TeacherOption { id: string; full_name: string }

// Настройка шаринга сданных работ (087_assignment_sharing) — по образцу
// BookPermissionsClient (app/teacher/books/permissions), но с добавленным
// общим тумблером "enabled" на объект (у книг такого не было — там сама
// возможность добавлять грант ничем не ограничивалась) и полем TTL.
export function StudentSharePermissionsClient({ students: initial, teachers }: {
  students: StudentRow[]
  teachers: TeacherOption[]
}) {
  const router = useRouter()
  const [students, setStudents] = useState(initial)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // `${studentId}` или `${studentId}:${teacherId}`
  const [ttlDraft, setTtlDraft] = useState<Record<string, string>>({})

  function patchStudent(studentId: string, patch: Partial<StudentRow>) {
    setStudents(prev => prev.map(s => (s.id === studentId ? { ...s, ...patch } : s)))
  }

  async function toggleEnabled(student: StudentRow) {
    const next = !student.enabled
    setBusy(student.id)
    try {
      const res = await fetch(`/api/admin/students/${student.id}/share-settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка'); return }
      patchStudent(student.id, { enabled: next })
      toast.success(next ? `Шаринг разрешён: ${student.full_name}` : `Шаринг запрещён: ${student.full_name}`)
      router.refresh()
    } finally { setBusy(null) }
  }

  async function saveTtl(student: StudentRow) {
    const raw = ttlDraft[student.id] ?? String(student.default_ttl_days)
    const days = parseInt(raw, 10)
    if (!Number.isFinite(days) || days < 1 || days > 90) {
      toast.error('Срок — целое число от 1 до 90 дней')
      return
    }
    setBusy(student.id)
    try {
      const res = await fetch(`/api/admin/students/${student.id}/share-settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: student.enabled, default_ttl_days: days }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка'); return }
      patchStudent(student.id, { default_ttl_days: days })
      toast.success('Срок действия обновлён')
      router.refresh()
    } finally { setBusy(null) }
  }

  async function toggleRecipient(student: StudentRow, teacher: TeacherOption) {
    const has = student.recipient_ids.includes(teacher.id)
    setBusy(`${student.id}:${teacher.id}`)
    try {
      const res = has
        ? await fetch(`/api/admin/students/${student.id}/share-recipients`, {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teacher_id: teacher.id }),
          })
        : await fetch(`/api/admin/students/${student.id}/share-recipients`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teacher_id: teacher.id }),
          })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка'); return }
      patchStudent(student.id, {
        recipient_ids: has
          ? student.recipient_ids.filter(id => id !== teacher.id)
          : [...student.recipient_ids, teacher.id],
      })
      toast.success(has ? `Убран из списка: ${teacher.full_name}` : `Добавлен в список: ${teacher.full_name}`)
      router.refresh()
    } finally { setBusy(null) }
  }

  if (students.length === 0) {
    return <p className="text-sm text-muted-foreground py-10 text-center">Учеников пока нет.</p>
  }

  return (
    <div className="space-y-2">
      {students.map(student => {
        const open = openId === student.id
        const b = busy === student.id
        return (
          <div key={student.id} className="rounded-md border">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <button type="button" onClick={() => setOpenId(open ? null : student.id)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left">
                {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                <User className="h-4 w-4 text-primary/70 shrink-0" />
                <span className="font-medium truncate">{student.full_name}</span>
                {student.grade && <Badge variant="outline" className="text-[11px] shrink-0">{student.grade}</Badge>}
                {student.recipient_ids.length > 0 && (
                  <span className="text-xs text-muted-foreground shrink-0">получателей: {student.recipient_ids.length}</span>
                )}
              </button>
              <Button size="sm" variant={student.enabled ? 'secondary' : 'outline'} className="h-7 px-2 text-[11px] shrink-0"
                disabled={b} onClick={() => toggleEnabled(student)}>
                {b ? <Loader2 className="h-3 w-3 animate-spin" /> : student.enabled ? 'Шаринг разрешён' : 'Шаринг запрещён'}
              </Button>
            </div>

            {open && (
              <div className="border-t px-3 py-2 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Срок действия гранта, дней:</span>
                  <Input
                    type="number" min={1} max={90} className="h-7 w-20 text-xs"
                    value={ttlDraft[student.id] ?? String(student.default_ttl_days)}
                    onChange={e => setTtlDraft(prev => ({ ...prev, [student.id]: e.target.value }))}
                    disabled={!student.enabled}
                  />
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                    disabled={b || !student.enabled} onClick={() => saveTtl(student)}>
                    Сохранить
                  </Button>
                </div>

                {!student.enabled && (
                  <p className="text-xs text-muted-foreground">
                    Шаринг запрещён — список получателей ниже не действует, пока не включите его выше.
                  </p>
                )}

                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="text-left font-medium py-1">Учитель</th>
                      <th className="text-center font-medium py-1 w-32">В списке</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teachers.length === 0 && (
                      <tr><td colSpan={2} className="py-4 text-center text-muted-foreground text-xs">Нет учителей</td></tr>
                    )}
                    {teachers.map(t => {
                      const has = student.recipient_ids.includes(t.id)
                      const rowBusy = busy === `${student.id}:${t.id}`
                      return (
                        <tr key={t.id} className="border-t">
                          <td className="py-1.5">{t.full_name}</td>
                          <td className="text-center">
                            <Button size="sm" variant={has ? 'secondary' : 'outline'} className="h-6 px-2 text-[11px]"
                              disabled={rowBusy} onClick={() => toggleRecipient(student, t)}>
                              {rowBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : has ? 'В списке' : 'Добавить'}
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
