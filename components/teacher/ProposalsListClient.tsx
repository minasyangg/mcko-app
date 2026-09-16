'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Sparkles, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { usePolling } from '@/lib/hooks/usePolling'

type ProposalStatus = 'pending' | 'confirmed' | 'rejected' | 'expired' | 'building' | 'built' | 'failed'

interface ProposalRow {
  id: string
  roadmap_id: string
  roadmap_title: string
  status: ProposalStatus
  title: string
  proposed_summary: string | null
  expires_at: string
  created_at: string
}

const STATUS_LABEL: Record<ProposalStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Ждёт подтверждения', variant: 'default' },
  confirmed: { label: 'Собирается…', variant: 'secondary' },
  building: { label: 'Собирается…', variant: 'secondary' },
  built: { label: 'Собрано', variant: 'outline' },
  rejected: { label: 'Пропущено', variant: 'outline' },
  expired: { label: 'Просрочено', variant: 'outline' },
  failed: { label: 'Не удалось собрать', variant: 'destructive' },
}

// Список предложений ДЗ от агента автосборки (project_homework_agent) —
// вкладка «Предложения» в «Мои задания». Обновляется сам (usePolling, тот
// же приём, что и бейджи в TeacherNav) — учитель не должен ждать ссылку в
// Telegram или обновлять страницу вручную, чтобы увидеть новое предложение.
export function ProposalsListClient({ initialProposals }: { initialProposals: ProposalRow[] }) {
  const [proposals, setProposals] = useState(initialProposals)

  usePolling(async () => {
    try {
      const res = await fetch('/api/teacher/proposals')
      if (!res.ok) return
      const json = await res.json()
      setProposals(json.proposals ?? [])
    } catch { /* сеть моргнула — обновится следующим тиком */ }
  }, { intervalMs: 30_000 })

  if (proposals.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Пока нет предложений от агента.</p>
        <p className="text-xs mt-1">Включите автосборку ДЗ в настройках программы — см. «Программы».</p>
      </div>
    )
  }

  const pending = proposals.filter(p => p.status === 'pending')
  const rest = proposals.filter(p => p.status !== 'pending')

  return (
    <div className="space-y-6">
      {pending.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Ждут вашего решения</h2>
          {pending.map(p => <ProposalRowCard key={p.id} proposal={p} />)}
        </div>
      )}
      {rest.length > 0 && (
        <div className="space-y-2">
          {pending.length > 0 && <h2 className="text-sm font-medium text-muted-foreground">Остальные</h2>}
          {rest.map(p => <ProposalRowCard key={p.id} proposal={p} />)}
        </div>
      )}
    </div>
  )
}

function ProposalRowCard({ proposal }: { proposal: ProposalRow }) {
  const status = STATUS_LABEL[proposal.status]
  const isPending = proposal.status === 'pending'

  return (
    <Link href={`/teacher/roadmaps/${proposal.roadmap_id}/proposals/${proposal.id}`}>
      <Card className={isPending ? 'border-primary/40 hover:border-primary/60 transition-colors' : 'hover:bg-muted/40 transition-colors'}>
        <CardContent className="py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{proposal.title}</span>
              <Badge variant={status.variant} className="shrink-0">{status.label}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              Программа «{proposal.roadmap_title}»{proposal.proposed_summary ? ` · ${proposal.proposed_summary}` : ''}
            </p>
          </div>
          {isPending && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
              <Clock className="h-3.5 w-3.5" />
              до {new Date(proposal.expires_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
