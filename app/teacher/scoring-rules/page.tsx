import { createClient } from '@/lib/supabase/server'
import { ScoringRulesClient } from '@/components/teacher/ScoringRulesClient'

export default async function ScoringRulesPage() {
  const supabase = await createClient()

  const { data: rules } = await supabase
    .from('scoring_rules')
    .select('*, scoring_rule_items ( id, task_number, max_score, note )')
    .order('name')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Правила оценивания</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Шаблоны максимальных баллов для каждого типа теста. Применяются автоматически при обработке заданий.
        </p>
      </div>
      <ScoringRulesClient initialRules={rules ?? []} />
    </div>
  )
}
