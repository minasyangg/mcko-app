import { createClient } from '@/lib/supabase/server'
import { ResultsClient } from '@/components/teacher/ResultsClient'
import { getAttemptRows } from '@/lib/analytics/queries'

export default async function ResultsPage() {
  const supabase = await createClient()
  const rows = await getAttemptRows(supabase, {})

  // Collect distinct tests/groups/programs for filters
  const testsMap = new Map<string, string>()
  const groupsMap = new Map<string, string>()
  const programsMap = new Map<string, string>()
  for (const r of rows) {
    if (r.testTitle !== '—') testsMap.set(r.testTitle, r.testTitle)
    if (r.groupName) groupsMap.set(r.groupName, r.groupName)
    if (r.programTitle) programsMap.set(r.programTitle, r.programTitle)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Результаты</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {rows.length} завершённых попыток
          </p>
        </div>
        <a
          href="/api/export/results"
          download="results.csv"
          className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-1.5 hover:bg-muted transition-colors"
        >
          ↓ Экспорт CSV
        </a>
      </div>

      <ResultsClient
        rows={rows}
        tests={[...testsMap.keys()]}
        groups={[...groupsMap.keys()]}
        programs={[...programsMap.keys()]}
      />
    </div>
  )
}
