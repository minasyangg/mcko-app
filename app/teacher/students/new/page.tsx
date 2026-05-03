'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'

const schema = z.object({
  full_name: z.string().min(2, 'Минимум 2 символа'),
  email: z.string().email('Некорректный email'),
  grade: z.string().optional(),
  password: z.string().min(6, 'Минимум 6 символов'),
  password_confirm: z.string(),
}).refine(d => d.password === d.password_confirm, {
  message: 'Пароли не совпадают',
  path: ['password_confirm'],
})

type FormData = z.infer<typeof schema>

export default function NewStudentPage() {
  const router = useRouter()
  const [showPwd, setShowPwd] = useState(false)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    const res = await fetch('/api/admin/create-student', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: data.full_name,
        email: data.email,
        grade: data.grade || undefined,
        password: data.password,
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
