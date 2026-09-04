'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'

const schema = z.object({
  full_name: z.string().trim().min(2, 'Минимум 2 символа'),
  email: z.string().email('Некорректный email'),
  password: z.string().min(6, 'Минимум 6 символов'),
  telegram_username: z.string().trim().max(64).optional().or(z.literal('')),
  phone: z.string().trim().max(32).optional().or(z.literal('')),
  // Zod 4: у literal нет errorMap, сообщение задаётся полем message
  pd_consent: z.literal(true, { message: 'Без согласия регистрация невозможна' }),
// Email обязателен как логин, но для связи по заявке этого мало: админ
// подтверждает вручную и должен иметь способ достучаться. Поэтому просим
// ещё хотя бы один контакт — telegram или телефон.
}).refine(d => !!d.telegram_username?.trim() || !!d.phone?.trim(), {
    message: 'Укажите ник в Telegram или номер телефона',
    path: ['telegram_username'],
  })

type FormData = z.infer<typeof schema>

export default function RegisterPage() {
  const router = useRouter()
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    const supabase = createClient()
    // Публичная регистрация — всегда ученик и всегда на модерацию.
    // self_signup читает триггер handle_new_user (миграция 054) и ставит
    // moderation_status='pending': роль, организацию и прочее выставит админ.
    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          full_name: data.full_name,
          role: 'student',
          self_signup: true,
          telegram_username: data.telegram_username?.trim()?.replace(/^@/, '') || null,
          phone: data.phone?.trim() || null,
        },
      },
    })
    if (error) {
      toast.error(error.message)
      return
    }
    router.push('/register/pending')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Регистрация</CardTitle>
        <CardDescription>
          Заявка проходит проверку администратором — доступ откроется после подтверждения
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="full_name">Фамилия и имя *</Label>
            <Input id="full_name" {...register('full_name')} />
            {errors.full_name && <p className="text-sm text-destructive">{errors.full_name.message}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="email">Email *</Label>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="password">Пароль *</Label>
            <PasswordInput id="password" autoComplete="new-password" {...register('password')} />
            {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
          </div>

          <div className="rounded-md border p-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Как с вами связаться по заявке — заполните хотя бы одно поле
            </p>
            <div className="space-y-1">
              <Label htmlFor="telegram_username">Ник в Telegram</Label>
              <Input id="telegram_username" placeholder="@username" {...register('telegram_username')} />
              {errors.telegram_username && (
                <p className="text-sm text-destructive">{errors.telegram_username.message}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="phone">Телефон</Label>
              <Input id="phone" type="tel" placeholder="+7 900 000-00-00" {...register('phone')} />
              {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
            </div>
          </div>

          <div className="space-y-1">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" {...register('pd_consent')} />
              <span className="text-sm text-muted-foreground">
                Я даю согласие на обработку моих персональных данных в соответствии с
                Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных».
                Данные используются только для работы в этой учебной платформе и
                третьим лицам не передаются.
              </span>
            </label>
            {errors.pd_consent && <p className="text-sm text-destructive">{errors.pd_consent.message}</p>}
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Отправка заявки...</>
              : 'Отправить заявку'}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Уже есть аккаунт?{' '}
          <Link href="/login" className="text-primary hover:underline">Войти</Link>
        </p>
      </CardContent>
    </Card>
  )
}
