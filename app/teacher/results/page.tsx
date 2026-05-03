import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Download, TrendingUp } from 'lucide-react'
import { getAttemptRows } from '@/lib/analytics/queries'

export default async function ResultsPage() {
  const supabase = await createClient()
  const rows = await getAttemptRows(supabase, {})

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Результаты</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {rows.length} завершённых попыток
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href="/api/export/results" download="results.csv">
            <Download className="h-4 w-4 mr-2" />
            Экспорт CSV
          </a>
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <TrendingUp className="h-10 w-10 opacity-40" />
          <p className="text-sm">Нет завершённых попыток.</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Ученик</th>
                <th className="text-left px-4 py-3 font-medium">Класс</th>
                <th className="text-left px-4 py-3 font-medium">Группа</th>
                <th className="text-left px-4 py-3 font-medium">Тест</th>
                <th className="text-center px-4 py-3 font-medium">Балл</th>
                <th className="text-center px-4 py-3 font-medium">%</th>
                <th className="text-left px-4 py-3 font-medium">Статус</th>
                <th className="text-left px-4 py-3 font-medium">Дата</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.attemptId} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{r.studentName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.grade ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.groupName ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[180px] truncate">{r.testTitle}</td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    <span className="font-semibold">{r.score}</span>
                    <span className="text-muted-foreground">/{r.maxScore}</span>
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
      )}
    </div>
  )
}
