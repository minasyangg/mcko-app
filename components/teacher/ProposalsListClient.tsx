'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Sparkles, Clock, FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { usePolling } from '@/lib/hooks/usePolling'

type ProposalStatus = 'pending' | 'confirmed' | 'rejected' | 'expired' | 'building' | 'built' | 'failed'

export interface ProposalRow {
  id: string
  roadmap_id: string
  roadmap_title: string
  status: ProposalStatus
  title: string
  proposed_summary: string | null
  expires_at: string
  created_at: string
  /** Когда предложение последний раз меняло состояние — для собранного ДЗ это момент сборки. */
  built_at: string | null
  test_id: string | null
  assignment_id: string | null
  /** Сколько заданий в собранном тесте; null — тест ещё не собран. */
  task_count: number | null
}

// Сборку ДЗ делает Claude Code по просьбе учителя (.claude/skills/
// homework-agent-build), сервер её не запускает — поэтому 'confirmed' это
// «ждёт, когда попросят собрать», а не «уже собирается». Статусы building/
// failed остались от удалённой серверной автосборки: живой путь их больше
// не выставляет, но старые строки с ними в БД сохраняются.
const STATUS_LABEL: Record<ProposalStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Ждёт подтверждения', variant: 'default' },
  confirmed: { label: 'Подтверждено — ждёт сборки', variant: 'secondary' },
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
        <p className="text-xs mt-1">
          ДЗ собирает Claude Code по вашей просьбе — здесь появятся собранные им
          задания со ссылкой на готовый тест.
        </p>
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

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function ProposalRowCard({ proposal }: { proposal: ProposalRow }) {
  const isPending = proposal.status === 'pending'
  const isBuilt = proposal.status === 'built' && !!proposal.test_id

  // Собранное ДЗ — черновик до тех пор, пока не создано назначение:
  // скилл сборки по умолчанию не публикует, учитель проверяет состав и
  // публикует сам. Без этого различения «Собрано» читается как «ученики
  // уже получили», хотя группе ничего не ушло.
  const status = isBuilt
    ? (proposal.assignment_id
        ? { label: 'Собрано и назначено', variant: 'outline' as const }
        : { label: 'Собрано — черновик', variant: 'outline' as const })
    : STATUS_LABEL[proposal.status]

  const details = [
    proposal.task_count !== null ? `${proposal.task_count} ${pluralTasks(proposal.task_count)}` : null,
    proposal.built_at ? `собрано ${formatDate(proposal.built_at)}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <Card className={isPending ? 'border-primary/40' : undefined}>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/teacher/roadmaps/${proposal.roadmap_id}/proposals/${proposal.id}`}
                className="font-medium text-sm truncate hover:underline"
              >
                {proposal.title}
              </Link>
              <Badge variant={status.variant} className="shrink-0">{status.label}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Программа «{proposal.roadmap_title}»{proposal.proposed_summary ? ` · ${proposal.proposed_summary}` : ''}
            </p>
          </div>
          {isPending && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
              <Clock className="h-3.5 w-3.5" />
              до {formatDate(proposal.expires_at)}
            </div>
          )}
        </div>

        {isBuilt && (
          <div className="flex items-center gap-2 flex-wrap text-xs border-t pt-2">
            <Link
              href={`/teacher/tests/${proposal.test_id}`}
              className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
            >
              <FileText className="h-3.5 w-3.5" />
              {proposal.assignment_id ? 'Открыть ДЗ' : 'Открыть черновик и опубликовать'}
            </Link>
            {details && <span className="text-muted-foreground">{details}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function pluralTasks(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'задание'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'задания'
  return 'заданий'
}
