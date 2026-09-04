import Link from 'next/link'
import { Clock, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Куда идёт человек сразу после отправки заявки. Отдельная страница, а не
// всплывающее сообщение: заявку подтверждают вручную, ждать можно долго, и
// текст с контактом поддержки должен оставаться на экране.
export default function RegistrationPendingPage() {
  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400">
          <Clock className="h-5 w-5" />
        </div>
        <CardTitle>Заявка отправлена</CardTitle>
        <CardDescription>Регистрация проходит модерацию</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Аккаунт создан, но доступ к платформе пока закрыт: заявку проверяет
          администратор. Он же назначит роль и подключит вас к нужным занятиям.
          После подтверждения вы сможете войти со своими email и паролем.
        </p>

        <div className="rounded-md border p-3">
          <p className="text-sm font-medium">Связаться с поддержкой</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Если проверка затянулась или нужно что-то уточнить — напишите в Telegram:
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
