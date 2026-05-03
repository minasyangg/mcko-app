import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Download, Users, Target, TrendingUp, Award } from 'lucide-react'
import { getTestAttemptStats, getTaskStats, getAttemptRows } from '@/lib/analytics/queries'

interface Props {
  params: Promise<{ id: string }>
}

export default async function TestAnalyticsPage({ params }: Props) {
  const { id: testId } = await params
  const supabase = await createClient()

  // Load test + published version
  const { data: test } = await supabase
    .from('tests')
    .select('id, title, subject, grade, exam_type, current_published_version_id')
    .eq('id', testId)
    .single()

  if (!test) redirect('/teacher/tests')

  const testVersionId = test.current_published_version_id
  if (!testVersionId) {
    return (
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/teacher/tests/${testId}`}><ArrowLeft className="h-4 w-4 mr-1" />Назад</Link>
          </Button>
          <h1 className="text-2xl font-semibold">Аналитика</h1>
        </div>
        <p className="text-muted-foreground text-sm">Тест ещё не опубликован. Опубликуйте тест чтобы увидеть аналитику.</p>
      </div>
    )
  }

  const [stats, taskStats, attemptRows] = await Promise.all([
    getTestAttemptStats(supabase, testVersionId),
    getTaskStats(supabase, testVersionId),
    getAttemptRows(supabase, { testVersionId }),
  ])

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/teacher/tests/${testId}`}><ArrowLeft className="h-4 w-4 mr-1" />Назад</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{test.title}</h1>
            <div className="flex items-center gap-2 mt-1">
              {test.subject && <span className="text-sm text-muted-foreground">{test.subject}</span>}
              {test.exam_type && <Badge variant="secondary">{test.exam_type}</Badge>}
            </div>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={`/api/export/results?test_version_id=${testVersionId}`} download="results.csv">
            <Download className="h-4 w-4 mr-2" />
            Экспорт CSV
          </a>
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Попыток</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.completedAttempts}</p>
            <p className="text-xs text-muted-foreground mt-1">из {stats.totalAttempts} начатых</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Средний балл</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.avgScore}</p>
            <p className="text-xs text-muted-foreground mt-1">из {stats.maxPossibleScore} ({stats.avgPercentage}%)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Медиана</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.medianScore}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.maxPossibleScore > 0
                ? `${Math.round((stats.medianScore / stats.maxPossibleScore) * 100)}%`
                : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Завершили</CardTitle>
            <Award className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.completionRate}%</p>
            <p className="text-xs text-muted-foreground mt-1">из начавших</p>
          </CardContent>
        </Card>
      </div>

      {/* Task breakdown */}
      {taskStats.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Анализ по задачам</h2>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium w-12">№</th>
                  <th className="text-left px-4 py-3 font-medium">Задача</th>
                  <th className="text-center px-4 py-3 font-medium">Ответов</th>
                  <th className="text-center px-4 py-3 font-medium">Правильно</th>
                  <th className="text-center px-4 py-3 font-medium">Ср. балл</th>
                  <th className="text-center px-4 py-3 font-medium">Запросов разбора</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {taskStats.map((t) => (
                    <tr key={t.taskId} className="hover:bg-muted/30">
                      <td className="px-4 py-3 text-muted-foreground font-mono">{t.taskNumber}</td>
                      <td className="px-4 py-3 max-w-[240px]">
                        <span className="line-clamp-2 text-sm">{t.promptText}</span>
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">{t.totalAnswers}</td>
                      <td className="px-4 py-3 text-center tabular-nums">
                        <span className="font-semibold">{t.correctRate}%</span>
                        <span className="text-muted-foreground text-xs ml-1">({t.correctCount}/{t.totalAnswers})</span>
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">
                        {t.avgAwarded}<span className="text-muted-foreground">/{t.maxScore}</span>
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">{t.solutionRequestCount}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Student results */}
      {attemptRows.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Результаты учеников</h2>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Ученик</th>
                  <th className="text-left px-4 py-3 font-medium">Класс / Группа</th>
                  <th className="text-center px-4 py-3 font-medium">Балл</th>
                  <th className="text-center px-4 py-3 font-medium">%</th>
                  <th className="text-left px-4 py-3 font-medium">Статус</th>
                  <th className="text-left px-4 py-3 font-medium">Дата</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {attemptRows.map((r) => (
                  <tr key={r.attemptId} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{r.studentName}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {[r.grade, r.groupName].filter(Boolean).join(' / ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums font-semibold">
                      {r.score}<span className="text-muted-foreground font-normal">/{r.maxScore}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={[
                        'font-semibold',
                        r.percentage >= 80 ? 'text-green-600' :
                        r.percentage >= 60 ? 'text-orange-500' : 'text-destructive'
                      ].join(' ')}>{r.percentage}%</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={r.status === 'checked' ? 'default' : 'secondary'} className="text-xs">
                        {r.status === 'checked' ? 'Проверено' : 'Отправлено'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {r.submittedAt ? new Date(r.submittedAt).toLocaleDateString('ru-RU') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
