'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { usePolling } from '@/lib/hooks/usePolling'
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
import { Plus, Eye, EyeOff, UserPlus, UsersRound } from 'lucide-react'
import { StudentsClient, type StudentRow, type TeacherOption } from '@/components/teacher/StudentsClient'
import { TeachersClient } from '@/components/teacher/TeachersClient'
import { ModerationTab, type PendingUser } from '@/components/teacher/ModerationTab'

interface TeacherRow {
  id: string
  full_name: string
  email: string
  is_active: boolean | null
  student_count: number
}

type Role = 'student' | 'teacher'

export function UsersClient({
  students, teachers, pending = [],
}: {
  students: StudentRow[]
  teachers: TeacherRow[]
  pending?: PendingUser[]
}) {
  const router = useRouter()

  // Живое обновление списков — единый механизм с мониторингом (см.
  // lib/hooks/usePolling): без него новая заявка на модерацию или новый
  // ученик, заведённый в другой вкладке, не появлялись здесь без ручной
  // перезагрузки страницы, пока админ на ней сидит.
  usePolling(() => router.refresh())

  const teacherOptions: TeacherOption[] = teachers.map(t => ({ id: t.id, full_name: t.full_name }))
  const studentsForAssign = students.map(s => ({
    id: s.id, full_name: s.full_name, grade: s.grade, teacher_ids: s.teacher_ids ?? [], is_active: s.is_active,
  }))

  // ── Единый диалог создания пользователя ──
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<Role>('student')
  const [form, setForm] = useState({ full_name: '', email: '', password: '', grade: '', teacher_id: '', telegram: '' })
  const [showPwd, setShowPwd] = useState(false)
  const [creating, setCreating] = useState(false)

  function reset() {
    setForm({ full_name: '', email: '', password: '', grade: '', teacher_id: '', telegram: '' })
    setRole('student')
    setShowPwd(false)
  }

  const telegram = form.telegram.trim().replace(/^@/, '')
  const telegramValid = telegram === '' || /^[A-Za-z0-9_]{5,32}$/.test(telegram)
  const valid =
    form.full_name.trim().length >= 2 &&
    form.email.includes('@') &&
    form.password.length >= 6 &&
    telegramValid &&
    (role === 'teacher' || !!form.teacher_id)

  async function handleCreate() {
    setCreating(true)
    try {
      const url = role === 'teacher' ? '/api/admin/create-teacher' : '/api/admin/create-student'
      const payload = role === 'teacher'
        ? { full_name: form.full_name, email: form.email, password: form.password, telegram_username: telegram || undefined }
        : {
            full_name: form.full_name, email: form.email, password: form.password,
            grade: form.grade || undefined, teacher_id: form.teacher_id,
            telegram_username: telegram || undefined,
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
      <div className="flex justify-end gap-2">
        <Button asChild variant="outline">
          <Link href="/teacher/groups">
            <UsersRound className="h-4 w-4 mr-2" />
            Группы
          </Link>
        </Button>
        <Button onClick={() => { reset(); setOpen(true) }}>
          <UserPlus className="h-4 w-4 mr-2" />
          Создать пользователя
        </Button>
      </div>

      <Tabs defaultValue="students" className="w-full">
        <TabsList>
          <TabsTrigger value="students">Ученики ({students.length})</TabsTrigger>
          <TabsTrigger value="teachers">Учителя ({teachers.length})</TabsTrigger>
          {/* Счётчик заявок — как бейдж «на проверке» в мониторинге: админ
              должен видеть новые регистрации, не заходя в таб */}
          <TabsTrigger value="moderation" className="gap-1.5">
            На модерации
            {pending.length > 0 && (
              <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-orange-500 px-1 text-[11px] font-semibold leading-none text-white">
                {pending.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="students" className="pt-4">
          {students.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Учеников пока нет.</p>
          ) : (
            <StudentsClient students={students} isAdmin teachers={teacherOptions} />
          )}
        </TabsContent>

        <TabsContent value="moderation" className="pt-4">
          <ModerationTab pending={pending} teachers={teacherOptions} />
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

            <div className="space-y-1">
              <Label htmlFor="u-tg">
                Ник Telegram <span className="text-muted-foreground text-xs">(необязательно)</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
                <Input id="u-tg" value={form.telegram}
                  onChange={(e) => setForm(p => ({ ...p, telegram: e.target.value.replace(/^@/, '') }))}
                  placeholder="username" className="pl-7" />
              </div>
              {!telegramValid && (
                <p className="text-xs text-destructive">5–32 символа: латиница, цифры, _</p>
              )}
              <p className="text-xs text-muted-foreground">
                Для уведомлений: пользователь затем откроет бота и нажмёт «Start».
              </p>
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
