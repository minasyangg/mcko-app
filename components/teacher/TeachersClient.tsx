'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { usePagination } from '@/lib/hooks/usePagination'
import { LoadMoreControl } from '@/components/shared/LoadMoreControl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogMedia, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ConfirmDeleteAction } from '@/components/shared/ConfirmDeleteAction'
import { UserAccountFields, cleanTelegram, isTelegramValid, type AccountFieldsValue } from '@/components/teacher/UserAccountFields'
import { Users, Search, LayoutDashboard, Pencil, Trash2, UserMinus, UserCheck, AlertTriangle } from 'lucide-react'

interface TeacherRow {
  id: string
  full_name: string
  email: string
  telegram_username?: string | null
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

const EMPTY_FORM: AccountFieldsValue = { full_name: '', telegram: '', email: '', password: '' }

// Таблица учителей: правка карточки, деактивация/возврат, удаление и диалог
// множественного закрепления учеников. Создание учителя — в общем диалоге
// «Создать пользователя» (UsersClient). Поля учётки — общие с карточкой
// ученика (UserAccountFields), API — /api/admin/teachers/[id].
export function TeachersClient({ teachers, students }: { teachers: TeacherRow[]; students: StudentRow[] }) {
  const router = useRouter()

  // ── Закрепление учеников ──
  const teacherNameById = useMemo(
    () => new Map(teachers.map(t => [t.id, t.full_name])),
    [teachers],
  )
  // По 15 строк — список учителей растёт вместе с организацией
  const { visible: pagedTeachers, hasMore, loadMore, total, showing } = usePagination(teachers, 15)
  const [assignTarget, setAssignTarget] = useState<TeacherRow | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [savingAssign, setSavingAssign] = useState(false)

  // ── Правка карточки ──
  const [editTarget, setEditTarget] = useState<TeacherRow | null>(null)
  const [editForm, setEditForm] = useState<AccountFieldsValue>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  function openAssign(t: TeacherRow) {
    setAssignTarget(t)
    setQuery('')
    setChecked(new Set(students.filter(s => s.teacher_ids.includes(t.id)).map(s => s.id)))
  }

  function openEdit(t: TeacherRow) {
    setEditTarget(t)
    setEditForm({ full_name: t.full_name, telegram: t.telegram_username ?? '', email: '', password: '' })
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

  const editTelegram = cleanTelegram(editForm.telegram)

  async function handleSave() {
    if (!editTarget) return
    if (!isTelegramValid(editTelegram)) { toast.error('Ник Telegram: 5–32 символа, латиница/цифры/_'); return }
    const body: Record<string, string> = {}
    if (editForm.full_name.trim() && editForm.full_name.trim() !== editTarget.full_name) body.full_name = editForm.full_name.trim()
    if (editTelegram !== (editTarget.telegram_username ?? '')) body.telegram_username = editTelegram
    if (editForm.email.trim()) body.email = editForm.email.trim()
    if (editForm.password.trim()) body.password = editForm.password.trim()
    if (Object.keys(body).length === 0) { setEditTarget(null); return }

    setSaving(true)
    try {
      const res = await fetch(`/api/admin/teachers/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка сохранения'); return }
      toast.success('Данные учителя обновлены')
      setEditTarget(null)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleSetActive(t: TeacherRow, active: boolean) {
    const res = await fetch(`/api/admin/teachers/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: active ? 'activate' : 'deactivate' }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(json.error ?? 'Ошибка'); return }
    toast.success(active ? `${t.full_name}: доступ восстановлен` : `${t.full_name} деактивирован`)
    router.refresh()
  }

  async function handleDelete(t: TeacherRow) {
    const res = await fetch(`/api/admin/teachers/${t.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(json.error ?? 'Ошибка удаления', { duration: 8000 }); return }
    toast.success(`${t.full_name} удалён`)
    router.refresh()
  }

  // Действия над учителем — общие для таблицы (десктоп) и карточки (телефон),
  // как renderStudentActions в StudentsClient
  const renderTeacherActions = (t: TeacherRow, isActive: boolean) => (
    <>
      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 max-md:h-9 max-md:w-9"
        onClick={() => openEdit(t)} title="Редактировать" aria-label="Редактировать">
        <Pencil className="h-3.5 w-3.5" />
      </Button>

      {/* Деактивировать / вернуть доступ — обратимо, материалы остаются */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          {isActive ? (
            <Button size="sm" variant="ghost"
              className="h-7 w-7 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50 max-md:h-9 max-md:w-9"
              title="Деактивировать" aria-label="Деактивировать">
              <UserMinus className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button size="sm" variant="ghost"
              className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 max-md:h-9 max-md:w-9"
              title="Вернуть доступ" aria-label="Вернуть доступ">
              <UserCheck className="h-3.5 w-3.5" />
            </Button>
          )}
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isActive ? 'Деактивировать учителя?' : 'Вернуть доступ учителю?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {isActive ? (
                <>
                  <strong>{t.full_name}</strong> больше не сможет войти. Тесты, группы, программы
                  и закреплённые ученики останутся за ним — доступ можно вернуть в любой момент.
                </>
              ) : (
                <><strong>{t.full_name}</strong> снова сможет войти со своим email и паролем.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleSetActive(t, !isActive)}
              className={isActive ? 'bg-amber-600 text-white hover:bg-amber-700' : undefined}
            >
              {isActive ? 'Деактивировать' : 'Вернуть доступ'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Удалить навсегда — сервер откажет, если у учителя есть материалы */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="ghost"
            className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10 max-md:h-9 max-md:w-9"
            title="Удалить навсегда" aria-label="Удалить навсегда">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <AlertTriangle />
            </AlertDialogMedia>
            <AlertDialogTitle>Удалить учителя навсегда?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                Аккаунт <strong>{t.full_name}</strong> будет удалён <strong>без возможности восстановления</strong>,
                ученики будут откреплены от него.
              </span>
              <span className="block">
                Удалить можно только учителя без тестов, назначений, групп, программ и журналов.
                Если они есть — деактивируйте учителя.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <ConfirmDeleteAction onConfirm={() => handleDelete(t)} label="Удалить навсегда" />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )

  const statusBadge = (isActive: boolean) => (
    <Badge variant={isActive ? 'default' : 'secondary'} className="shrink-0">
      {isActive ? 'Активен' : 'Неактивен'}
    </Badge>
  )

  return (
    <>
      <div className="rounded-md border overflow-hidden">
        {/* Телефон: карточки — колонка кнопок w-60 одна была шире половины экрана */}
        <ul className="divide-y md:hidden">
          {teachers.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-muted-foreground">Учителей пока нет.</li>
          )}
          {pagedTeachers.map(t => {
            const isActive = t.is_active !== false
            return (
              <li key={t.id} className={`space-y-2 p-3 ${!isActive ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-medium leading-snug wrap-break-word">{t.full_name}</p>
                    {t.email && <p className="text-xs text-muted-foreground break-all">{t.email}</p>}
                    <p className="text-xs text-muted-foreground">Учеников: {t.student_count}</p>
                  </div>
                  {statusBadge(isActive)}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Button asChild size="icon" variant="outline" className="h-9 w-9" title="Кабинет учителя" aria-label="Кабинет учителя">
                      <Link href={`/teacher/users/${t.id}/cabinet`}>
                        <LayoutDashboard className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" className="h-9" onClick={() => openAssign(t)}>
                      <Users className="h-3.5 w-3.5 mr-1.5" />
                      Ученики
                    </Button>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">{renderTeacherActions(t, isActive)}</div>
                </div>
              </li>
            )
          })}
        </ul>
        <table className="w-full text-sm max-md:hidden">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">ФИО</th>
              <th className="text-left px-4 py-3 font-medium">Email</th>
              <th className="text-left px-4 py-3 font-medium">Учеников</th>
              <th className="text-left px-4 py-3 font-medium">Статус</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {teachers.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                Учителей пока нет.
              </td></tr>
            )}
            {pagedTeachers.map(t => {
              const isActive = t.is_active !== false
              return (
                <tr key={t.id} className={`hover:bg-muted/30 transition-colors ${!isActive ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-1.5">
                      <Button
                        asChild
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
                        title="Кабинет учителя"
                      >
                        <Link href={`/teacher/users/${t.id}/cabinet`}>
                          <LayoutDashboard className="h-4 w-4" />
                        </Link>
                      </Button>
                      <span>{t.full_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{t.email || '—'}</td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary">{t.student_count}</Badge>
                  </td>
                  <td className="px-4 py-3">{statusBadge(isActive)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="outline" className="mr-1" onClick={() => openAssign(t)}>
                        <Users className="h-3.5 w-3.5 mr-1.5" />
                        Ученики
                      </Button>
                      {renderTeacherActions(t, isActive)}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <LoadMoreControl
        hasMore={hasMore}
        loadMore={loadMore}
        remaining={total - showing}
        step={15}
        totalLabel={total > 15 ? `Показано всего ${total} учителей` : undefined}
      />

      {/* Правка карточки учителя */}
      <Dialog open={!!editTarget} onOpenChange={(v) => { if (!v) setEditTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Редактировать: {editTarget?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <UserAccountFields
              idPrefix="edit-teacher"
              value={editForm}
              onChange={(patch) => setEditForm((p) => ({ ...p, ...patch }))}
              currentEmail={editTarget?.email}
              telegramHint="Для уведомлений. Смена ника отвяжет старый чат — учитель заново нажмёт «Start» у бота."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={saving}>Отмена</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <div className="max-h-80 overflow-y-auto rounded-md border divide-y max-md:max-h-[45dvh]">
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
                      <span className="text-[11px] text-amber-600 shrink-0 max-md:max-w-[40%] max-md:truncate">закреплён: {otherTeacher}</span>
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
