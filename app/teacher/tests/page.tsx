import { createClient } from '@/lib/supabase/server'
import { TestsListClient, type TestRow } from '@/components/teacher/TestsListClient'

export default async function TestsPage() {
  const supabase = await createClient()

  const { data: tests } = await supabase
    .from('tests')
    .select('id, title, subject, grade, exam_type, status, is_active, created_at, kind')
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Задания</h1>
        <p className="text-sm text-muted-foreground mt-1">Тесты и домашние задания</p>
      </div>
      <TestsListClient rows={(tests ?? []) as TestRow[]} />
    </div>
  )
}
