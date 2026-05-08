import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { name, exam_type, grade, subject, items } = body

  const admin = createAdminClient()

  await admin.from('scoring_rules').update({
    name, exam_type: exam_type || null, grade: grade || null, subject: subject || null, updated_at: new Date().toISOString(),
  }).eq('id', id)

  // Replace items
  await admin.from('scoring_rule_items').delete().eq('rule_id', id)
  if (items?.length) {
    await admin.from('scoring_rule_items').insert(
      items.map((item: { task_number: number; max_score: number; note?: string }) =>
        ({ rule_id: id, task_number: item.task_number, max_score: item.max_score, note: item.note ?? null })
      )
    )
  }

  return Response.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  await createAdminClient().from('scoring_rules').delete().eq('id', id)
  return Response.json({ ok: true })
}
