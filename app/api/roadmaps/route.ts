import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  title: z.string().trim().min(2, 'Введите название'),
  subject: z.string().trim().optional().nullable(),
  description: z.string().trim().optional().nullable(),
})

// POST /api/roadmaps — учитель создаёт программу. Вместе с ней создаётся
// скрытая системная группа (её участники = ученики road map).
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single()
  if (!profile || profile.role !== 'teacher' || !profile.organization_id) {
    return NextResponse.json({ error: 'Создавать программы может только учитель' }, { status: 403 })
  }

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const { title, subject, description } = parsed.data
  const admin = createAdminClient()

  // 1. Программа (без group_id)
  const { data: roadmap, error: rmErr } = await admin.from('roadmaps').insert({
    organization_id: profile.organization_id,
    created_by: user.id,
    title,
    subject: subject || null,
    description: description || null,
  }).select('id').single()
  if (rmErr || !roadmap) return NextResponse.json({ error: rmErr?.message ?? 'Ошибка' }, { status: 500 })

  // 2. Скрытая системная группа этой программы
  const { data: group, error: gErr } = await admin.from('groups').insert({
    organization_id: profile.organization_id,
    created_by: user.id,
    name: `Программа: ${title}`,
    roadmap_id: roadmap.id,
  }).select('id').single()
  if (gErr || !group) {
    await admin.from('roadmaps').delete().eq('id', roadmap.id)
    return NextResponse.json({ error: gErr?.message ?? 'Ошибка группы' }, { status: 500 })
  }

  // 3. Связать программу с группой
  await admin.from('roadmaps').update({ group_id: group.id }).eq('id', roadmap.id)

  return NextResponse.json({ id: roadmap.id }, { status: 201 })
}
