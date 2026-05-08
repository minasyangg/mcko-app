import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Plus, ClipboardList } from 'lucide-react'
import { DeleteAssignmentButton } from '@/components/teacher/DeleteAssignmentButton'

export default async function AssignmentsPage() {
  const supabase = await createClient()

  const { data: assignments } = await supabase
    .from('assignments')
    .select(`
      id, starts_at, ends_at, max_attempts, created_at,
      group_id, student_id,
      test_versions!test_version_id ( tests!test_id ( title ) ),
      groups ( name ),
      profiles!student_id ( full_name ),
      attempts ( id, status, student_id )
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Назначения</h1>
          <p className="text-sm text-muted-foreground mt-1">Тесты, назначенные группам и ученикам</p>
        </div>
        <Button asChild>
          <Link href="/teacher/assignments/new">
            <Plus className="h-4 w-4 mr-2" />
            Назначить тест
          </Link>
        </Button>
      </div>

      {!assignments?.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          <ClipboardList className="h-10 w-10 opacity-40" />
          <p>Нет назначений. Назначьте тест группе или ученику.</p>
          <Button asChild variant="outline">
            <Link href="/teacher/assignments/new">Назначить тест</Link>
          </Button>
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Тест</th>
                <th className="text-left px-4 py-3 font-medium">Для кого</th>
                <th className="text-left px-4 py-3 font-medium">Начало</th>
                <th className="text-left px-4 py-3 font-medium">Конец</th>
                <th className="text-left px-4 py-3 font-medium">Попыток</th>
                <th className="text-left px-4 py-3 font-medium">Создано</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {assignments.map((a) => {
                const tv = a.test_versions as any
                const test = tv?.tests as any
                const group = a.groups as any
                const profile = (a as any).profiles as any
                const allAttempts = ((a as any).attempts ?? []) as { id: string; status: string; student_id: string }[]
                const completedCount = allAttempts.filter(at => ['submitted', 'checked'].includes(at.status)).length
                const maxAttempts = a.max_attempts ?? 1
                const isCompleted = completedCount >= maxAttempts && completedCount > 0
                const target = group?.name
                  ? `Группа: ${group.name}`
                  : profile?.full_name
                  ? profile.full_name
                  : a.student_id
                  ? 'Ученик'
                  : '—'
                return (
                  <tr key={a.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{test?.title ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{target}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {a.starts_at
                        ? new Date(a.starts_at).toLocaleDateString('ru-RU')
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {a.ends_at
                        ? new Date(a.ends_at).toLocaleDateString('ru-RU')
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {isCompleted
                        ? <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">✓ Завершён ({completedCount}/{maxAttempts})</span>
                        : <span className="text-muted-foreground">{completedCount}/{maxAttempts}</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {a.created_at
                        ? new Date(a.created_at).toLocaleDateString('ru-RU')
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <DeleteAssignmentButton assignmentId={a.id} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
