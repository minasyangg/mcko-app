import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('scoring_rules')
    .select('*, scoring_rule_items ( * )')
    .order('name')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { name, exam_type, grade, subject, items } = body as {
    name: string
    exam_type?: string
    grade?: string
    subject?: string
    items: { task_number: number; max_score: number; note?: string }[]
  }

  const admin = createAdminClient()

  const { data: rule, error } = await admin.from('scoring_rules').insert({
    organization_id: profile.organization_id!,
    created_by: user.id,
    name,
    exam_type: exam_type || null,
    grade: grade || null,
    subject: subject || null,
  }).select('id').single()

  if (error || !rule) return Response.json({ error: error?.message }, { status: 500 })

  if (items?.length) {
    await admin.from('scoring_rule_items').insert(
      items.map(item => ({ rule_id: rule.id, task_number: item.task_number, max_score: item.max_score, note: item.note ?? null }))
    )
  }

  return Response.json({ id: rule.id }, { status: 201 })
}
