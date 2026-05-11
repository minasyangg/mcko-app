import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Plus, BookOpen } from 'lucide-react'
import { DeleteTestButton } from '@/components/teacher/DeleteTestButton'

const statusLabel: Record<string, string> = {
  draft: 'Черновик',
  in_review: 'На проверке',
  published: 'Опубликован',
  archived: 'Архив',
}

const statusVariant: Record<string, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  in_review: 'secondary',
  published: 'default',
  archived: 'outline',
}

export default async function TestsPage() {
  const supabase = await createClient()

  const { data: tests } = await supabase
    .from('tests')
    .select('id, title, subject, grade, exam_type, status, is_active, created_at')
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Тесты</h1>
          <p className="text-sm text-muted-foreground mt-1">Управление тестами и заданиями</p>
        </div>
        <Button asChild>
          <Link href="/teacher/tests/new">
            <Plus className="h-4 w-4 mr-2" />
            Создать тест
          </Link>
        </Button>
      </div>

      {!tests?.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          <BookOpen className="h-10 w-10 opacity-40" />
          <p>Нет тестов. Создайте первый тест.</p>
          <Button asChild variant="outline">
            <Link href="/teacher/tests/new">Создать тест</Link>
          </Button>
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Название</th>
                <th className="text-left px-4 py-3 font-medium">Предмет</th>
                <th className="text-left px-4 py-3 font-medium">Класс</th>
                <th className="text-left px-4 py-3 font-medium">Тип</th>
                <th className="text-left px-4 py-3 font-medium">Статус</th>
                <th className="text-left px-4 py-3 font-medium">Создан</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {tests.map((test) => (
                <tr key={test.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{test.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">{test.subject ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{test.grade ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{test.exam_type ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant={statusVariant[test.status] ?? 'secondary'}>
                        {statusLabel[test.status] ?? test.status}
                      </Badge>
                      {test.status === 'published' && !(test as any).is_active && (
                        <Badge variant="outline" className="text-orange-600 border-orange-400 text-xs">
                          Снят
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {test.created_at
                      ? new Date(test.created_at).toLocaleDateString('ru-RU')
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/teacher/tests/${test.id}`}>Открыть</Link>
                      </Button>
                      <DeleteTestButton testId={test.id} testTitle={test.title} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
