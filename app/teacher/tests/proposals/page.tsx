import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ProposalsListClient } from '@/components/teacher/ProposalsListClient'

// «Предложения» — вкладка в «Мои задания» со списком предложений ДЗ от
// агента автосборки (project_homework_agent), вместо единственной ссылки в
// Telegram-сообщении. Список сам обновляется на клиенте (usePolling), здесь
// только первичная серверная загрузка — как и остальные списки учителя.
export default async function ProposalsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: proposals } = await supabase
    .from('homework_proposals')
    .select('id, roadmap_id, status, proposed_title, final_title, proposed_summary, expires_at, created_at, roadmaps!roadmap_id(title)')
    .order('created_at', { ascending: false })
    .limit(50)

  const rows = (proposals ?? []).map(p => ({
    id: p.id,
    roadmap_id: p.roadmap_id,
    roadmap_title: (p.roadmaps as unknown as { title: string } | null)?.title ?? '—',
    status: p.status as 'pending' | 'confirmed' | 'rejected' | 'expired' | 'building' | 'built' | 'failed',
    title: p.final_title ?? p.proposed_title,
    proposed_summary: p.proposed_summary,
    expires_at: p.expires_at,
    created_at: p.created_at,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Предложения агента</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Автоматически собранные темы ДЗ — подтвердите или отредактируйте перед публикацией
        </p>
      </div>
      <ProposalsListClient initialProposals={rows} />
    </div>
  )
}
