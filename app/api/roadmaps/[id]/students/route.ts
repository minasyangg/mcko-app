import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'
import { authorizeRoadmap } from '@/lib/roadmaps/authorize'

const schema = z.object({ student_ids: z.array(zUuid()).default([]) })

// PATCH /api/roadmaps/[id]/students — задать полный набор учеников программы.
// Синхронизирует членство скрытой системной группы. Привязать можно только
// закреплённых за учителем учеников (M:N teacher_students).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authorizeRoadmap(id)
  if ('error' in auth) return auth.error
  const { admin, userId, groupId } = auth
  if (!groupId) return NextResponse.json({ error: 'У программы нет группы' }, { status: 400 })

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const wanted = [...new Set(parsed.data.student_ids)]

  // Оставляем только тех, кто реально закреплён за этим учителем (M:N)
  let valid: string[] = []
  if (wanted.length > 0) {
    const { data: links } = await admin
      .from('teacher_students').select('student_id')
      .eq('teacher_id', userId).in('student_id', wanted)
    valid = (links ?? []).map(l => l.student_id)
    if (valid.length !== wanted.length) {
      return NextResponse.json({ error: 'Можно привязать только своих учеников' }, { status: 403 })
    }
  }

  // Убрать лишних
  let del = admin.from('group_members').delete().eq('group_id', groupId)
  if (valid.length > 0) del = del.not('user_id', 'in', `(${valid.join(',')})`)
  await del

  // Добавить недостающих
  if (valid.length > 0) {
    await admin.from('group_members').upsert(
      valid.map(uid => ({ group_id: groupId, user_id: uid })),
      { onConflict: 'group_id,user_id' }
    )
  }

  return NextResponse.json({ ok: true, count: valid.length })
}
