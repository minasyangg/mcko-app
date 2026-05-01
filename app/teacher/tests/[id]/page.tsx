import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { ArrowLeft, Plus } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'

interface PageProps {
  params: Promise<{ id: string }>
}

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

async function createNewVersion(testId: string, currentMaxVersion: number) {
  'use server'
  const supabase = createAdminClient()
  await supabase.from('test_versions').insert({
    test_id: testId,
    version_number: currentMaxVersion + 1,
    status: 'draft',
  })
  redirect(`/teacher/tests/${testId}`)
}

export default async function TestDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: test, error } = await supabase
    .from('tests')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !test) {
    notFound()
  }

  const { data: versions } = await supabase
    .from('test_versions')
    .select('*')
    .eq('test_id', id)
    .order('version_number', { ascending: false })

  const latestVersion = versions?.[0]

  const { data: latestJobs } = latestVersion
    ? await supabase
        .from('parsing_jobs')
        .select('id, status, created_at')
        .eq('test_version_id', latestVersion.id)
        .order('created_at', { ascending: false })
        .limit(1)
    : { data: null }

  const latestJob = latestJobs?.[0] ?? null
  const maxVersionNumber = versions?.reduce((max, v) => Math.max(max, v.version_number), 0) ?? 0

  const createVersionAction = createNewVersion.bind(null, id, maxVersionNumber)

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/teacher/tests">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Назад
          </Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{test.title}</h1>
            <Badge variant={statusVariant[test.status] ?? 'secondary'}>
              {statusLabel[test.status] ?? test.status}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {test.subject && <span>Предмет: {test.subject}</span>}
            {test.grade && <span>Класс: {test.grade}</span>}
            {test.exam_type && <span>Тип: {test.exam_type}</span>}
          </div>
          {test.description && (
            <p className="text-sm text-muted-foreground mt-2">{test.description}</p>
          )}
        </div>

        <form action={createVersionAction}>
          <Button type="submit" variant="outline" size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Новая версия
          </Button>
        </form>
      </div>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Версии теста</CardTitle>
        </CardHeader>
        <CardContent>
          {!versions?.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Нет версий. Нажмите &quot;Новая версия&quot; для создания.
            </p>
          ) : (
            <div className="space-y-3">
              {versions.map((version) => {
                const isLatest = version.id === latestVersion?.id
                const hasJob = isLatest && latestJob?.status === 'done'

                return (
                  <div
                    key={version.id}
                    className="flex items-center justify-between py-3 px-4 rounded-md border bg-muted/20"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-sm">
                        Версия {version.version_number}
                      </span>
                      <Badge variant={statusVariant[version.status] ?? 'secondary'} className="text-xs">
                        {statusLabel[version.status] ?? version.status}
                      </Badge>
                      {version.published_at && (
                        <span className="text-xs text-muted-foreground">
                          Опубликована:{' '}
                          {new Date(version.published_at).toLocaleDateString('ru-RU')}
                        </span>
                      )}
                    </div>

                    <div className="flex gap-2">
                      {version.status === 'draft' && !hasJob && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/teacher/tests/${id}/import?version=${version.id}`}>
                            Загрузить PDF
                          </Link>
                        </Button>
                      )}
                      {version.status === 'draft' && hasJob && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/teacher/tests/${id}/review`}>
                            Проверить
                          </Link>
                        </Button>
                      )}
                      {version.status === 'in_review' && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/teacher/tests/${id}/review`}>
                            Проверить
                          </Link>
                        </Button>
                      )}
                      {version.status === 'published' && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/teacher/assignments/new?version=${version.id}`}>
                            Назначить
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
