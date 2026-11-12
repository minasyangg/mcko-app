import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Страница не найдена' }

// Несуществующий адрес и notFound() из страниц. Ссылка ведёт на главную:
// app/page.tsx сам отправит в нужный кабинет или на вход.
export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-4">
      <FileQuestion className="h-12 w-12 text-muted-foreground opacity-60" />
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Страница не найдена</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          Такого адреса нет. Возможно, ссылка устарела или в ней опечатка.
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href="/">На главную</Link>
      </Button>
    </div>
  )
}
