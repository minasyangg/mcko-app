'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { BulkDeleteStudentsBar } from '@/components/teacher/BulkDeleteStudentsBar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogMedia, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ConfirmDeleteAction } from '@/components/shared/ConfirmDeleteAction'
import { Pencil, Trash2, UserX, Eye, EyeOff, UserMinus, AlertTriangle } from 'lucide-react'

export interface StudentRow {
  id: string
  full_name: string
  grade: string | null
  // 'student' = выпускник школы, учится в вузе: класса нет, вместо него бейдж.
  // string, а не литералы: в БД это text с CHECK-констрейнтом, и generate-types
  // отдаёт его как string — сужать тип пришлось бы кастом на каждой странице.
  study_stage?: string | null
  is_active: boolean | null
  created_at: string | null
  created_by?: string | null
  teacher_ids?: string[]  // прикреплённые учителя (M:N)
  email?: string
  telegram_username?: string | null
}

export interface TeacherOption {
  id: string
  full_name: string
}

interface Props {
  students: StudentRow[]
  // admin: полный CRUD + колонка «Учитель» с переназначением;
  // teacher: read-only список своих учеников
  isAdmin?: boolean
  teachers?: TeacherOption[]
}

export function StudentsClient({ students: initial, isAdmin = false, teachers = [] }: Props) {
  const router = useRouter()
  const [students, setStudents] = useState<StudentRow[]>(initial)
  // Массовый выбор для удаления (только у админа, см. панель ниже)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editTarget, setEditTarget] = useState<StudentRow | null>(null)
  const [editForm, setEditForm] = useState({ full_name: '', grade: '', email: '', password: '', telegram: '' })
  const [showPwd, setShowPwd] = useState(false)
  const [saving, setSaving] = useState(false)

  // Диалог прикрепления учителей к ученику (M:N)
  const [teacherTarget, setTeacherTarget] = useState<StudentRow | null>(null)
  const [checkedTeachers, setCheckedTeachers] = useState<Set<string>>(new Set())
  const [savingTeachers, setSavingTeachers] = useState(false)
  const teacherName = (id: string) => teachers.find(t => t.id === id)?.full_name ?? '—'

  function openTeachers(s: StudentRow) {
    setTeacherTarget(s)
    setCheckedTeachers(new Set(s.teacher_ids ?? []))
  }

  async function handleSaveTeachers() {
    if (!teacherTarget) return
    setSavingTeachers(true)
    try {
      const teacher_ids = [...checkedTeachers]
      const res = await fetch(`/api/admin/students/${teacherTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher_ids }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Ошибка сохранения'); return }
      setStudents(prev => prev.map(s => s.id === teacherTarget.id ? { ...s, teacher_ids } : s))
      toast.success('Учителя обновлены')
      setTeacherTarget(null)
      router.refresh()
    } finally {
      setSavingTeachers(false)
    }
  }

  function openEdit(s: StudentRow) {
    setEditTarget(s)
    setEditForm({ full_name: s.full_name, grade: s.grade ?? '', email: '', password: '', telegram: s.telegram_username ?? '' })
    setShowPwd(false)
  }

  const editTelegram = editForm.telegram.trim().replace(/^@/, '')
  const editTelegramValid = editTelegram === '' || /^[A-Za-z0-9_]{5,32}$/.test(editTelegram)

  async function handleSave() {
    if (!editTarget) return
    if (!editTelegramValid) { toast.error('Ник Telegram: 5–32 символа, латиница/цифры/_'); return }
    setSaving(true)
    try {
      const body: Record<string, string | null> = {}
      if (editForm.full_name.trim() && editForm.full_name !== editTarget.full_name)
        body.full_name = editForm.full_name.trim()
      if (editForm.grade !== (editTarget.grade ?? ''))
        body.grade = editForm.grade.trim() || null
      if (editForm.email.trim()) body.email = editForm.email.trim()
      if (editForm.password.trim()) body.password = editForm.password.trim()
      if (editTelegram !== (editTarget.telegram_username ?? ''))
        body.telegram_username = editTelegram

      if (Object.keys(body).length === 0) { setEditTarget(null); return }

      const res = await fetch(`/api/admin/students/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Ошибка сохранения'); return }

      setStudents((prev) => prev.map((s) =>
        s.id === editTarget.id
          ? {
              ...s,
              full_name: body.full_name ?? s.full_name,
              grade: body.grade !== undefined ? body.grade : s.grade,
              telegram_username: body.telegram_username !== undefined ? body.telegram_username : s.telegram_username,
            }
          : s
      ))
      toast.success('Данные обновлены')
      setEditTarget(null)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate(student: StudentRow) {
    const res = await fetch(`/api/admin/students/${student.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deactivate' }),
    })
    const json = await res.json()
    if (!res.ok) { toast.error(json.error ?? 'Ошибка деактивации'); return }
    setStudents((prev) => prev.map((s) => s.id === student.id ? { ...s, is_active: false } : s))
    toast.success(`${student.full_name} деактивирован`)
    router.refresh()
  }

  async function handleHardDelete(student: StudentRow) {
    const res = await fetch(`/api/admin/students/${student.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      toast.error(json.error ?? 'Ошибка удаления')
      return
    }
    setStudents((prev) => prev.filter((s) => s.id !== student.id))
    toast.success(`${student.full_name} удалён`)
    router.refresh()
  }

  return (
    <>
      {/* Массовое удаление — только админу: у учителя нет прав удалять чужих
          учеников, и панель ему только мешала бы */}
      {isAdmin && (
        <div className="mb-3">
          <BulkDeleteStudentsBar
            selectedIds={[...selected]}
            onClear={() => setSelected(new Set())}
          />
        </div>
      )}
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {isAdmin && (
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={students.length > 0 && students.every(s => selected.has(s.id))}
                    onChange={(e) => setSelected(prev => {
                      const n = new Set(prev)
                      for (const s of students) { if (e.target.checked) n.add(s.id); else n.delete(s.id) }
                      return n
                    })}
                    title="Выбрать всех"
                  />
                </th>
              )}
              <th className="text-left px-4 py-3 font-medium">ФИО</th>
              <th className="text-left px-4 py-3 font-medium">Email</th>
              <th className="text-left px-4 py-3 font-medium">Класс</th>
              {isAdmin && <th className="text-left px-4 py-3 font-medium">Учителя</th>}
              <th className="text-left px-4 py-3 font-medium">Статус</th>
              <th className="text-left px-4 py-3 font-medium">Дата</th>
              {isAdmin && <th className="px-4 py-3 w-24" />}
            </tr>
          </thead>
          <tbody className="divide-y">
            {students.map((s) => {
              const isActive = s.is_active !== false
              return (
                <tr key={s.id} className={`hover:bg-muted/30 transition-colors ${!isActive ? 'opacity-60' : ''}`}>
                  {isAdmin && (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selected.has(s.id)}
                        onChange={() => setSelected(prev => {
                          const n = new Set(prev)
                          if (n.has(s.id)) n.delete(s.id); else n.add(s.id)
                          return n
                        })}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium">
                    <span className={!isActive ? 'text-muted-foreground line-through' : ''}>
                      {s.full_name}
                    </span>
                    {!isActive && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <UserX className="h-3.5 w-3.5" />Выбыл
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{s.email || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.study_stage === 'student'
                      ? <Badge variant="secondary" className="font-normal">Студент</Badge>
                      : (s.grade ?? '—')}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap max-w-64">
                        {(s.teacher_ids ?? []).length === 0 ? (
                          <span className="text-xs text-muted-foreground">Не закреплён</span>
                        ) : (
                          (s.teacher_ids ?? []).map((tid) => (
                            <Badge key={tid} variant="outline" className="text-[11px] font-normal">
                              {teacherName(tid)}
                            </Badge>
                          ))
                        )}
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs"
                          onClick={() => openTeachers(s)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <Badge variant={isActive ? 'default' : 'secondary'}>
                      {isActive ? 'Активен' : 'Неактивен'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.created_at ? new Date(s.created_at).toLocaleDateString('ru-RU') : '—'}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => openEdit(s)}
                          title="Редактировать"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>

                        {/* Деактивировать (soft) */}
                        {isActive && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 w-7 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                title="Деактивировать"
                              >
                                <UserMinus className="h-3.5 w-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Деактивировать ученика?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  <strong>{s.full_name}</strong> будет помечен как неактивный.
                                  Назначения и членство в группах будут удалены.
                                  История попыток и результаты тестов сохранятся.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Отмена</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeactivate(s)}
                                  className="bg-amber-600 text-white hover:bg-amber-700"
                                >
                                  Деактивировать
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}

                        {/* Удалить навсегда (hard) */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                              title="Удалить навсегда"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogMedia className="bg-destructive/10 text-destructive">
                                <AlertTriangle />
                              </AlertDialogMedia>
                              <AlertDialogTitle>Удалить ученика навсегда?</AlertDialogTitle>
                              <AlertDialogDescription className="space-y-2">
                                <span className="block">
                                  Это действие <strong>необратимо</strong>. Будут удалены:
                                </span>
                                <ul className="list-disc list-inside text-sm space-y-0.5">
                                  <li>Аккаунт и профиль <strong>{s.full_name}</strong></li>
                                  <li>Все его попытки и ответы</li>
                                  <li>Все назначения</li>
                                  <li>Членство в группах</li>
                                  <li>Результаты тестов</li>
                                </ul>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Отмена</AlertDialogCancel>
                              <ConfirmDeleteAction onConfirm={() => handleHardDelete(s)} label="Удалить навсегда" />
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Edit dialog (admin only) */}
      {isAdmin && (
        <Dialog open={!!editTarget} onOpenChange={(v) => { if (!v) setEditTarget(null) }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Редактировать: {editTarget?.full_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label htmlFor="edit-name">Полное имя</Label>
                <Input
                  id="edit-name"
                  value={editForm.full_name}
                  onChange={(e) => setEditForm((p) => ({ ...p, full_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-grade">Класс</Label>
                <Input
                  id="edit-grade"
                  value={editForm.grade}
                  onChange={(e) => setEditForm((p) => ({ ...p, grade: e.target.value }))}
                  placeholder="10А, 9Б..."
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-tg">
                  Ник Telegram <span className="text-muted-foreground text-xs">(необязательно)</span>
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
                  <Input
                    id="edit-tg"
                    value={editForm.telegram}
                    onChange={(e) => setEditForm((p) => ({ ...p, telegram: e.target.value.replace(/^@/, '') }))}
                    placeholder="username"
                    className="pl-7"
                  />
                </div>
                {!editTelegramValid && <p className="text-xs text-destructive">5–32 символа: латиница, цифры, _</p>}
                <p className="text-xs text-muted-foreground">Смена ника отвяжет старый чат — ученик заново нажмёт «Start».</p>
              </div>
              {editTarget?.email && (
                <div className="space-y-1">
                  <Label className="text-muted-foreground">Текущий email</Label>
                  <p className="text-sm px-3 py-2 rounded-md bg-muted text-muted-foreground font-mono">{editTarget.email}</p>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="edit-email">Новый email <span className="text-muted-foreground text-xs">(необязательно)</span></Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
                  placeholder="Оставьте пустым, чтобы не менять"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-pwd">Новый пароль <span className="text-muted-foreground text-xs">(необязательно)</span></Label>
                <div className="relative">
                  <Input
                    id="edit-pwd"
                    type={showPwd ? 'text' : 'password'}
                    value={editForm.password}
                    onChange={(e) => setEditForm((p) => ({ ...p, password: e.target.value }))}
                    placeholder="Минимум 6 символов"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPwd((v) => !v)}
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditTarget(null)} disabled={saving}>
                Отмена
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Прикрепление учителей к ученику (M:N) */}
      {isAdmin && (
        <Dialog open={!!teacherTarget} onOpenChange={(v) => { if (!v) setTeacherTarget(null) }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Учителя ученика: {teacherTarget?.full_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Ученика можно закрепить за несколькими учителями. Каждый учитель видит
                только свои тесты и результаты этого ученика.
              </p>
              <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
                {teachers.length === 0 && (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">Учителей нет</p>
                )}
                {teachers.map((t) => (
                  <label key={t.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40">
                    <input
                      type="checkbox"
                      checked={checkedTeachers.has(t.id)}
                      onChange={() => setCheckedTeachers((prev) => {
                        const next = new Set(prev)
                        if (next.has(t.id)) next.delete(t.id); else next.add(t.id)
                        return next
                      })}
                      className="h-4 w-4 shrink-0"
                    />
                    <span className="text-sm">{t.full_name}</span>
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTeacherTarget(null)} disabled={savingTeachers}>
                Отмена
              </Button>
              <Button onClick={handleSaveTeachers} disabled={savingTeachers}>
                {savingTeachers ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
