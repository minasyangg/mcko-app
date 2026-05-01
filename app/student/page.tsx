import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'

export default async function StudentHomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: assignments } = await supabase
    .from('assignments')
    .select(`
      id, starts_at, ends_at, max_attempts,
      test_versions (
        id, time_limit_sec,
        tests ( id, title, subject, exam_type )
      )
    `)
    .or(`student_id.eq.${user!.id},group_id.in.(select group_id from group_members where user_id = '${user!.id}')`)
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Мои тесты</h1>
        <p className="text-muted-foreground text-sm mt-1">Назначенные вам тесты</p>
      </div>
      {!assignments?.length ? (
        <p className="text-muted-foreground">Нет назначенных тестов.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assignments.map((a) => {
            const tv = a.test_versions as any
            const test = tv?.tests as any
            return (
              <Link key={a.id} href={`/student/attempt/${a.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-tight">{test?.title ?? 'Тест'}</CardTitle>
                      {test?.exam_type && <Badge variant="secondary">{test.exam_type}</Badge>}
                    </div>
                    {test?.subject && <CardDescription>{test.subject}</CardDescription>}
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground space-y-1">
                    {tv?.time_limit_sec && (
                      <p>Время: {Math.round(tv.time_limit_sec / 60)} мин</p>
                    )}
                    {a.ends_at && (
                      <p>До: {new Date(a.ends_at).toLocaleDateString('ru-RU')}</p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
