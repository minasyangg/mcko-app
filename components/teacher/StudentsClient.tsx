'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
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
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Pencil, Trash2, UserX, Eye, EyeOff, UserMinus } from 'lucide-react'

export interface StudentRow {
  id: string
  full_name: string
  grade: string | null
  is_active: boolean | null
  created_at: string | null
}

interface Props {
  students: StudentRow[]
}

export function StudentsClient({ students: initial }: Props) {
  const router = useRouter()
  const [students, setStudents] = useState<StudentRow[]>(initial)
  const [editTarget, setEditTarget] = useState<StudentRow | null>(null)
  const [editForm, setEditForm] = useState({ full_name: '', grade: '', email: '', password: '' })
  const [showPwd, setShowPwd] = useState(false)
  const [saving, setSaving] = useState(false)

  function openEdit(s: StudentRow) {
    setEditTarget(s)
    setEditForm({ full_name: s.full_name, grade: s.grade ?? '', email: '', password: '' })
    setShowPwd(false)
  }

  async function handleSave() {
    if (!editTarget) return
    setSaving(true)
    try {
      const body: Record<string, string | null> = {}
      if (editForm.full_name.trim() && editForm.full_name !== editTarget.full_name)
        body.full_name = editForm.full_name.trim()
      if (editForm.grade !== (editTarget.grade ?? ''))
        body.grade = editForm.grade.trim() || null
      if (editForm.email.trim()) body.email = editForm.email.trim()
      if (editForm.password.trim()) body.password = editForm.password.trim()

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
          ? { ...s, full_name: body.full_name ?? s.full_name, grade: body.grade !== undefined ? body.grade : s.grade }
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
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">ФИО</th>
              <th className="text-left px-4 py-3 font-medium">Класс</th>
              <th className="text-left px-4 py-3 font-medium">Статус</th>
              <th className="text-left px-4 py-3 font-medium">Дата регистрации</th>
              <th className="px-4 py-3 w-24" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {students.map((s) => {
              const isActive = s.is_active !== false
              return (
                <tr key={s.id} className={`hover:bg-muted/30 transition-colors ${!isActive ? 'opacity-60' : ''}`}>
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
                  <td className="px-4 py-3 text-muted-foreground">{s.grade ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge variant={isActive ? 'default' : 'secondary'}>
                      {isActive ? 'Активен' : 'Неактивен'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.created_at ? new Date(s.created_at).toLocaleDateString('ru-RU') : '—'}
                  </td>
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
                            <AlertDialogAction
                              onClick={() => handleHardDelete(s)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Удалить навсегда
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Edit dialog */}
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
    </>
  )
}
