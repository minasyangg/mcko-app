'use client'

import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft, Eye, EyeOff, Loader2, ShieldAlert } from 'lucide-react'
import Link from 'next/link'

const schema = z.object({
  full_name: z.string().min(2, 'Минимум 2 символа'),
  email: z.string().email('Некорректный email'),
  grade: z.string().optional(),
  password: z.string().min(6, 'Минимум 6 символов'),
  password_confirm: z.string(),
  teacher_id: z.string().min(1, 'Выберите учителя'),
}).refine(d => d.password === d.password_confirm, {
  message: 'Пароли не совпадают',
  path: ['password_confirm'],
})

type FormData = z.infer<typeof schema>

interface TeacherOption { id: string; full_name: string }

export default function NewStudentPage() {
  const router = useRouter()
  const supabase = createClient()
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [teachers, setTeachers] = useState<TeacherOption[]>([])

  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data: profile } = await supabase
          .from('profiles')
          .select('role, organization_id')
          .eq('id', user.id)
          .single()

        // Создание учеников — только admin (у teacher список read-only)
        if (profile?.role !== 'admin') { setIsAdmin(false); return }
        setIsAdmin(true)

        const { data: teacherRows } = await supabase
          .from('profiles')
          .select('id, full_name')
          .eq('role', 'teacher')
          .eq('organization_id', profile.organization_id ?? '')
          .order('full_name')
        setTeachers(teacherRows ?? [])
      } finally {
        setLoading(false)
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onSubmit(data: FormData) {
    const res = await fetch('/api/admin/create-student', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: data.full_name,
        email: data.email,
        grade: data.grade || undefined,
        password: data.password,
        teacher_id: data.teacher_id,
      }),
    })
    const json = await res.json()
    if (!res.ok) {
      toast.error(json.error ?? 'Ошибка при создании ученика')
      return
    }
    toast.success(`Ученик ${data.full_name} добавлен`)
    router.push('/teacher/students')
    router.refresh()
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
        <Loader2 className="h-4 w-4 animate-spin" />Загрузка...
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="max-w-lg space-y-6">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/teacher/students">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Назад
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold">Новый ученик</h1>
        </div>
        <div className="flex items-start gap-3 rounded-md bg-muted border px-4 py-3 text-sm text-muted-foreground">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <p>
            Создавать учеников и закреплять их за учителями может только
            администратор. Обратитесь к администратору вашей организации.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/teacher/students">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Назад
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">Новый ученик</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Данные ученика</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="full_name">Полное имя *</Label>
              <Input id="full_name" placeholder="Иванов Иван Иванович" {...register('full_name')} />
              {errors.full_name && <p className="text-sm text-destructive">{errors.full_name.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="email">Email *</Label>
                <Input id="email" type="email" placeholder="student@example.com" {...register('email')} />
                {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="grade">Класс</Label>
                <Input id="grade" placeholder="10А, 9Б..." {...register('grade')} />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Учитель *</Label>
              <Controller name="teacher_id" control={control} render={({ field }) => (
                <Select
                  value={field.value || undefined}
                  onValueChange={(v) => field.onChange(v)}
                >
                  <SelectTrigger className={errors.teacher_id ? 'border-destructive' : ''}>
                    <SelectValue placeholder="За кем закрепить ученика" />
                  </SelectTrigger>
                  <SelectContent>
                    {teachers.length === 0
                      ? <SelectItem value="_none" disabled>Нет учителей в организации</SelectItem>
                      : teachers.map(t => <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
              {errors.teacher_id && <p className="text-sm text-destructive">{errors.teacher_id.message}</p>}
            </div>

            <div className="space-y-1">
              <Label htmlFor="password">Пароль *</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  placeholder="Минимум 6 символов"
                  {...register('password')}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPwd(v => !v)}
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>

            <div className="space-y-1">
              <Label htmlFor="password_confirm">Подтвердите пароль *</Label>
              <Input
                id="password_confirm"
                type={showPwd ? 'text' : 'password'}
                placeholder="Повторите пароль"
                {...register('password_confirm')}
              />
              {errors.password_confirm && <p className="text-sm text-destructive">{errors.password_confirm.message}</p>}
            </div>

            <p className="text-xs text-muted-foreground">
              Ученик сможет войти сразу — подтверждение email не требуется.
            </p>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Создание...' : 'Создать ученика'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
