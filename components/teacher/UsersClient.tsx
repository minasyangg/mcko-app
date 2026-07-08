'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Plus, Eye, EyeOff, UserPlus } from 'lucide-react'
import { StudentsClient, type StudentRow, type TeacherOption } from '@/components/teacher/StudentsClient'
import { TeachersClient } from '@/components/teacher/TeachersClient'

interface TeacherRow {
  id: string
  full_name: string
  email: string
  is_active: boolean | null
  student_count: number
}

type Role = 'student' | 'teacher'

export function UsersClient({
  students, teachers,
}: {
  students: StudentRow[]
  teachers: TeacherRow[]
}) {
  const router = useRouter()
  const teacherOptions: TeacherOption[] = teachers.map(t => ({ id: t.id, full_name: t.full_name }))
  const studentsForAssign = students.map(s => ({
    id: s.id, full_name: s.full_name, grade: s.grade, created_by: s.created_by ?? null, is_active: s.is_active,
  }))

  // ── Единый диалог создания пользователя ──
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<Role>('student')
  const [form, setForm] = useState({ full_name: '', email: '', password: '', grade: '', teacher_id: '' })
  const [showPwd, setShowPwd] = useState(false)
  const [creating, setCreating] = useState(false)

  function reset() {
    setForm({ full_name: '', email: '', password: '', grade: '', teacher_id: '' })
    setRole('student')
    setShowPwd(false)
  }

  const valid =
    form.full_name.trim().length >= 2 &&
    form.email.includes('@') &&
    form.password.length >= 6 &&
    (role === 'teacher' || !!form.teacher_id)

  async function handleCreate() {
    setCreating(true)
    try {
      const url = role === 'teacher' ? '/api/admin/create-teacher' : '/api/admin/create-student'
      const payload = role === 'teacher'
        ? { full_name: form.full_name, email: form.email, password: form.password }
        : {
            full_name: form.full_name, email: form.email, password: form.password,
            grade: form.grade || undefined, teacher_id: form.teacher_id,
          }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Ошибка создания'); return }
      toast.success(`${role === 'teacher' ? 'Учитель' : 'Ученик'} ${form.full_name} создан`)
      setOpen(false)
      reset()
      router.refresh()
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => { reset(); setOpen(true) }}>
          <UserPlus className="h-4 w-4 mr-2" />
          Создать пользователя
        </Button>
      </div>

      <Tabs defaultValue="students" className="w-full">
        <TabsList>
          <TabsTrigger value="students">Ученики ({students.length})</TabsTrigger>
          <TabsTrigger value="teachers">Учителя ({teachers.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="students" className="pt-4">
          {students.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Учеников пока нет.</p>
          ) : (
            <StudentsClient students={students} isAdmin teachers={teacherOptions} />
          )}
        </TabsContent>

        <TabsContent value="teachers" className="pt-4">
          <TeachersClient teachers={teachers} students={studentsForAssign} />
        </TabsContent>
      </Tabs>

      {/* Единый диалог создания */}
      <Dialog open={open} onOpenChange={(v) => { if (!v) setOpen(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Новый пользователь</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Роль</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">Ученик</SelectItem>
                  <SelectItem value="teacher">Учитель</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="u-name">Полное имя</Label>
              <Input id="u-name" value={form.full_name}
                onChange={(e) => setForm(p => ({ ...p, full_name: e.target.value }))}
                placeholder="Иванов Иван Иванович" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="u-email">Email</Label>
                <Input id="u-email" type="email" value={form.email}
                  onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="user@example.com" />
              </div>
              {role === 'student' && (
                <div className="space-y-1">
                  <Label htmlFor="u-grade">Класс</Label>
                  <Input id="u-grade" value={form.grade}
                    onChange={(e) => setForm(p => ({ ...p, grade: e.target.value }))}
                    placeholder="10А, 9Б..." />
                </div>
              )}
            </div>

            {role === 'student' && (
              <div className="space-y-1">
                <Label>Ответственный учитель</Label>
                <Select value={form.teacher_id} onValueChange={(v) => setForm(p => ({ ...p, teacher_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Выберите учителя" /></SelectTrigger>
                  <SelectContent>
                    {teacherOptions.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">Сначала создайте учителя</div>
                    )}
                    {teacherOptions.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="u-pwd">Пароль</Label>
              <div className="relative">
                <Input id="u-pwd" type={showPwd ? 'text' : 'password'} value={form.password}
                  onChange={(e) => setForm(p => ({ ...p, password: e.target.value }))}
                  placeholder="Минимум 6 символов" className="pr-10" />
                <button type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPwd(v => !v)}>
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Пользователь сможет войти сразу — подтверждение email не требуется.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>Отмена</Button>
            <Button onClick={handleCreate} disabled={creating || !valid}>
              {creating ? 'Создание...' : <><Plus className="h-4 w-4 mr-1.5" />Создать</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
