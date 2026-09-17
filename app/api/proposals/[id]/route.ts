import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const patchSchema = z.object({
  action: z.enum(['confirm', 'reject']).optional(),
  final_title: z.string().trim().min(1).max(200).optional(),
  teacher_note: z.string().trim().max(2000).optional().nullable(),
  // По умолчанию (не передано / false) — сборка (см. .claude/skills/
  // homework-agent-build) собирает только черновик, учитель проверяет и
  // публикует сам. true — чекбокс «Опубликовать сразу».
  publish_immediately: z.boolean().optional(),
})

type Params = { params: Promise<{ id: string }> }

// PATCH /api/proposals/[id] — правка предложения учителем (final_title/
// teacher_note) и/или смена статуса (action). RLS ("homework_proposals:
// teacher manage own", 082) уже гарантирует teacher_id = auth.uid() —
// отдельная авторизация как в authorizeRoadmap не нужна, работаем через
// RLS-клиент, не admin.
//
// action='confirm' ТОЛЬКО переводит pending→confirmed — сборку теста
// (bookкнижный источник без темы дал в первом живом прогоне 2026-09-16
// набор заданий не по теме, см. project_homework_agent) теперь делает не
// автоматический buildHomework() по SQL-фильтру, а сам учитель, вручную
// попросив Claude Code собрать ДЗ для confirmed-предложения — Claude читает
// текст каждого кандидата и отбирает подходящие по смыслу
// (.claude/skills/homework-agent-build/SKILL.md). Эта ручка больше не
// строит тест сама.
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const { action, final_title, teacher_note, publish_immediately } = parsed.data

  const { data: proposal } = await supabase
    .from('homework_proposals')
    .select('id, status')
    .eq('id', id)
    .single()
  if (!proposal) return NextResponse.json({ error: 'Предложение не найдено' }, { status: 404 })

  if (proposal.status !== 'pending') {
    return NextResponse.json(
      { error: `Предложение уже в статусе «${proposal.status}» — правка и подтверждение доступны только для pending` },
      { status: 422 }
    )
  }

  const patch: {
    updated_at: string
    final_title?: string
    teacher_note?: string | null
    publish_immediately?: boolean
    status?: 'confirmed' | 'rejected'
    confirmed_at?: string
    confirmed_by?: string
  } = { updated_at: new Date().toISOString() }
  if (final_title !== undefined) patch.final_title = final_title
  if (teacher_note !== undefined) patch.teacher_note = teacher_note
  if (publish_immediately !== undefined) patch.publish_immediately = publish_immediately

  if (action === 'reject') {
    patch.status = 'rejected'
  } else if (action === 'confirm') {
    patch.status = 'confirmed'
    patch.confirmed_at = new Date().toISOString()
    patch.confirmed_by = user.id
  }

  const { error: updateError } = await supabase.from('homework_proposals').update(patch).eq('id', id)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
