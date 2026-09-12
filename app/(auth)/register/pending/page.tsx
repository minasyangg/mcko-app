import Link from 'next/link'
import { Clock, XCircle, Send } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Куда идёт человек сразу после отправки заявки — и куда middleware держит
// его же, если админ заявку отклонил (см. proxy.ts). Текст и иконка теперь
// зависят от статуса: раньше «rejected» видел ровно тот же текст «проходит
// модерацию», что и «pending» — хотя рассмотрение уже закончилось отказом,
// и ждать больше нечего.
export default async function RegistrationPendingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = user
    ? await supabase
        .from('profiles')
        .select('moderation_status, moderation_note')
        .eq('id', user.id)
        .single()
    : { data: null }

  const isRejected = profile?.moderation_status === 'rejected'

  return (
    <Card>
      <CardHeader>
        <div
          className={
            'mb-2 flex h-11 w-11 items-center justify-center rounded-full ' +
            (isRejected
              ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400')
          }
        >
          {isRejected ? <XCircle className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
        </div>
        <CardTitle>{isRejected ? 'Заявка отклонена' : 'Заявка отправлена'}</CardTitle>
        <CardDescription>
          {isRejected ? 'Регистрация не подтверждена администратором' : 'Регистрация проходит модерацию'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isRejected ? (
          <>
            <p className="text-sm text-muted-foreground">
              Администратор отклонил эту заявку, доступ к платформе не открыт.
            </p>
            {profile?.moderation_note && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/40">
                <p className="font-medium text-red-800 dark:text-red-400">Причина</p>
                <p className="mt-1 text-red-700 dark:text-red-300">{profile.moderation_note}</p>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Аккаунт создан, но доступ к платформе пока закрыт: заявку проверяет
            администратор. Он же назначит роль и подключит вас к нужным занятиям.
            После подтверждения вы сможете войти со своими email и паролем.
          </p>
        )}

        <div className="rounded-md border p-3">
          <p className="text-sm font-medium">Связаться с поддержкой</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isRejected
              ? 'Если решение кажется ошибочным — напишите в Telegram:'
              : 'Если проверка затянулась или нужно что-то уточнить — напишите в Telegram:'}
          </p>
          <Button asChild variant="outline" size="sm" className="mt-2.5">
            <a href="https://t.me/mmaliby" target="_blank" rel="noopener noreferrer">
              <Send className="mr-1.5 h-3.5 w-3.5" />
              @mmaliby
            </a>
          </Button>
        </div>

        <div className="pt-1 text-center">
          <Link href="/login" className="text-sm text-primary hover:underline">
            Вернуться ко входу
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
