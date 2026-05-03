import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MessageSquare } from 'lucide-react'
import { SolutionRequestActions } from '@/components/teacher/SolutionRequestActions'

export default async function SolutionRequestsPage() {
  const supabase = await createClient()

  const { data: requests } = await supabase
    .from('solution_requests')
    .select(`
      id, status, student_message, created_at, expires_at,
      student_id,
      profiles ( full_name ),
      test_tasks ( task_number, prompt_text,
        test_versions!test_version_id ( tests!test_id ( title ) )
      )
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  const all = requests ?? []
  const pending = all.filter((r) => r.status === 'pending')

  function RequestTable({ items }: { items: typeof all }) {
    if (!items.length) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-2">
          <MessageSquare className="h-8 w-8 opacity-40" />
          <p className="text-sm">Нет запросов</p>
        </div>
      )
    }

    return (
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Ученик</th>
              <th className="text-left px-4 py-3 font-medium">Задача</th>
              <th className="text-left px-4 py-3 font-medium">Тест</th>
              <th className="text-left px-4 py-3 font-medium">Сообщение</th>
              <th className="text-left px-4 py-3 font-medium">Дата</th>
              <th className="text-left px-4 py-3 font-medium">Статус</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((r) => {
              const profile = r.profiles as any
              const task = r.test_tasks as any
              const tv = task?.test_versions as any
              const test = tv?.tests as any
              return (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors align-top">
                  <td className="px-4 py-3 font-medium">{profile?.full_name ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    №{task?.task_number ?? '?'}
                    {task?.prompt_text && (
                      <p className="text-xs line-clamp-1 mt-0.5 text-muted-foreground/70">
                        {task.prompt_text}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{test?.title ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[200px]">
                    <p className="line-clamp-2">{r.student_message || '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {r.created_at
                      ? new Date(r.created_at).toLocaleDateString('ru-RU')
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        r.status === 'approved' ? 'default'
                          : r.status === 'rejected' ? 'secondary'
                          : 'outline'
                      }
                    >
                      {r.status === 'pending' ? 'Ожидает'
                        : r.status === 'approved' ? 'Одобрен'
                        : 'Отклонён'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {r.status === 'pending' && (
                      <SolutionRequestActions
                        requestId={r.id}
                        studentName={profile?.full_name ?? 'ученика'}
                      />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Запросы на решения</h1>
        {pending.length > 0 && (
          <Badge variant="destructive">{pending.length}</Badge>
        )}
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            Ожидают
            {pending.length > 0 && (
              <span className="ml-1.5 rounded-full bg-destructive text-destructive-foreground text-xs px-1.5 py-0.5 leading-none">
                {pending.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="all">Все ({all.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-4">
          <RequestTable items={pending} />
        </TabsContent>
        <TabsContent value="all" className="mt-4">
          <RequestTable items={all} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
