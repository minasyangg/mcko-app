import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { ProposalReviewCard, type ProposalStatus } from '@/components/teacher/ProposalReviewCard'

// Страница подтверждения/правки предложения ДЗ от агента автосборки
// (project_homework_agent). MVP-путь без inline-кнопок в Telegram: ссылка
// на эту страницу — это и есть весь UI фазы 1 для учителя. RLS
// ("homework_proposals: teacher manage own", 082) сама отдаёт только своё
// предложение — отдельная проверка владения программой не нужна.
export default async function ProposalReviewPage({
  params,
}: {
  params: Promise<{ id: string; proposalId: string }>
}) {
  const { id, proposalId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: proposal } = await supabase
    .from('homework_proposals')
    .select('*')
    .eq('id', proposalId)
    .eq('roadmap_id', id)
    .single()
  if (!proposal) notFound()

  const { data: roadmap } = await supabase
    .from('roadmaps')
    .select('title')
    .eq('id', id)
    .single()
  if (!roadmap) notFound()

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <ProposalReviewCard
        // status у homework_proposals ограничен CHECK-constraint (082) до
        // ровно тех значений, что перечислены в ProposalStatus — Supabase
        // типизирует колонку как text, сужаем явно.
        proposal={{ ...proposal, status: proposal.status as ProposalStatus }}
        roadmapId={id}
        roadmapTitle={roadmap.title}
      />
    </div>
  )
}
