'use client'

import { useState } from 'react'
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
  email: z.string().email('Некорректный email'),
  password: z.string().min(6, 'Минимум 6 символов'),
})
type FormData = z.infer<typeof schema>

/* Куда вернуть человека после входа, если его сюда прислали с параметром next.
   Пускаем только внутренние пути: «//» и «/\» браузер считает адресом другого
   сайта, и без этой проверки ссылка на страницу входа стала бы открытым
   редиректом. Пусто или чужое — ведём себя как раньше. */
function safeNext(raw: string | null): string | null {
  if (!raw) return null
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null
  return raw
}

export default function LoginPage() {
  const router = useRouter()
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  // Индикатор держится и на время редиректа после успешного входа
  const [redirecting, setRedirecting] = useState(false)
  const busy = isSubmitting || redirecting

  async function onSubmit(data: FormData) {
    const supabase = createClient()
    setRedirecting(false)
    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    })
    if (error) {
      toast.error(error.message)
      return
    }
    // Держим индикатор до самого перехода: isSubmitting снимется раньше, чем
    // отрисуется следующая страница, и без этого кнопка на секунду
    // возвращалась в исходное состояние — выглядело как «клик не сработал».
    setRedirecting(true)
    // Пришли за доской — возвращаем туда, а не в кабинет. Именно
    // location.assign, а не router: next ведёт на /api/doska/open, это не
    // страница, и клиентский роутер на ней спотыкается, тогда как обычный
    // переход спокойно отработает редирект на доску.
    const next = safeNext(new URLSearchParams(window.location.search).get('next'))
    if (next) {
      window.location.assign(next)
      return
    }
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Вход</CardTitle>
        <CardDescription>Введите email и пароль для входа в систему</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="password">Пароль</Label>
            <PasswordInput id="password" autoComplete="current-password" {...register('password')} />
            {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Вход...</>
              : 'Войти'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Нет аккаунта?{' '}
            <Link href="/register" className="underline underline-offset-4 hover:text-primary">
              Зарегистрироваться
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
