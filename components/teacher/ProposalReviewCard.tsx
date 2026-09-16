'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, XCircle, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

export type ProposalStatus = 'pending' | 'confirmed' | 'rejected' | 'expired' | 'building' | 'built' | 'failed'

interface Proposal {
  id: string
  status: ProposalStatus
  proposed_title: string
  proposed_summary: string | null
  final_title: string | null
  teacher_note: string | null
  expires_at: string
  test_id: string | null
  build_error: string | null
}

const STATUS_LABEL: Record<ProposalStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Ждёт подтверждения', variant: 'default' },
  confirmed: { label: 'Подтверждено, собирается…', variant: 'secondary' },
  building: { label: 'Собирается…', variant: 'secondary' },
  built: { label: 'ДЗ собрано и назначено', variant: 'outline' },
  rejected: { label: 'Пропущено', variant: 'outline' },
  expired: { label: 'Просрочено', variant: 'outline' },
  failed: { label: 'Не удалось собрать', variant: 'destructive' },
}

// MVP-путь подтверждения предложения агента (project_homework_agent, этап
// 6-7 плана): без inline-кнопок в Telegram — учитель подтверждает/правит
// прямо здесь. Confirm сразу запускает сборку (PATCH .../route.ts вызывает
// buildHomework), поэтому кнопка после клика ведёт себя как "запускаю",
// не "сохраняю на потом".
export function ProposalReviewCard({
  proposal, roadmapId, roadmapTitle,
}: {
  proposal: Proposal
  roadmapId: string
  roadmapTitle: string
}) {
  const router = useRouter()
  const [finalTitle, setFinalTitle] = useState(proposal.final_title ?? proposal.proposed_title)
  const [note, setNote] = useState(proposal.teacher_note ?? '')
  const [busy, setBusy] = useState<'confirm' | 'reject' | null>(null)

  const editable = proposal.status === 'pending'
  const status = STATUS_LABEL[proposal.status]

  async function patch(body: Record<string, unknown>, busyKind: 'confirm' | 'reject') {
    setBusy(busyKind)
    try {
      const res = await fetch(`/api/proposals/${proposal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? 'Ошибка сохранения')
        return
      }
      if (busyKind === 'confirm') {
        if (json.build?.ok) {
          toast.success('ДЗ собрано и назначено')
        } else {
          toast.error(json.build?.reason === 'shortfall'
            ? 'Не хватило заданий по теме — соберите ДЗ вручную'
            : 'Не удалось собрать ДЗ — подробности в статусе ниже')
        }
      } else {
        toast.success('Предложение пропущено')
      }
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  function handleConfirm() {
    patch({ action: 'confirm', final_title: finalTitle.trim(), teacher_note: note.trim() || null }, 'confirm')
  }
  function handleReject() {
    patch({ action: 'reject' }, 'reject')
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-muted-foreground" />
            Предложение ДЗ
          </CardTitle>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <CardDescription>Программа «{roadmapTitle}»</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {proposal.proposed_summary && (
          <p className="text-sm text-muted-foreground">{proposal.proposed_summary}</p>
        )}

        <div className="space-y-1">
          <Label htmlFor="proposal-title">Тема ДЗ</Label>
          <Input
            id="proposal-title"
            value={finalTitle}
            onChange={(e) => setFinalTitle(e.target.value)}
            disabled={!editable}
            maxLength={200}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="proposal-note">Заметка агенту (необязательно)</Label>
          <Textarea
            id="proposal-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={!editable}
            placeholder="Например: добавь ещё про производную"
            rows={3}
            maxLength={2000}
          />
        </div>

        {proposal.status === 'failed' && proposal.build_error && (
          <p className="text-sm text-destructive">{proposal.build_error}</p>
        )}
        {proposal.status === 'built' && proposal.test_id && (
          <a href={`/teacher/tests/${proposal.test_id}`} className="text-sm text-primary underline">
            Открыть собранный тест
          </a>
        )}
      </CardContent>

      {editable && (
        <CardFooter className="gap-2">
          <Button onClick={handleConfirm} disabled={busy !== null || finalTitle.trim().length === 0}>
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            {busy === 'confirm' ? 'Собираю…' : 'Подтвердить'}
          </Button>
          <Button variant="outline" onClick={handleReject} disabled={busy !== null}>
            <XCircle className="h-4 w-4 mr-1.5" />
            {busy === 'reject' ? 'Пропускаю…' : 'Пропустить'}
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
