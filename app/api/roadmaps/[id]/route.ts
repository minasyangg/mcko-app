import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeRoadmap } from '@/lib/roadmaps/authorize'
import { deleteAssignmentsDeep } from '@/lib/assignments/cleanup'

const patchSchema = z.object({
  title: z.string().trim().min(2).optional(),
  subject: z.string().trim().optional().nullable(),
  description: z.string().trim().optional().nullable(),
})

// PATCH /api/roadmaps/[id] — переименовать/изменить программу (владелец)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authorizeRoadmap(id)
  if ('error' in auth) return auth.error
  const { admin, groupId } = auth

  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const patch: { title?: string; subject?: string | null; description?: string | null } = {}
  if (parsed.data.title !== undefined) patch.title = parsed.data.title
  if (parsed.data.subject !== undefined) patch.subject = parsed.data.subject || null
  if (parsed.data.description !== undefined) patch.description = parsed.data.description || null
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })

  const { error } = await admin.from('roadmaps').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Синхронизируем имя системной группы с названием программы
  if (patch.title && groupId) {
    await admin.from('groups').update({ name: `Программа: ${patch.title}` }).eq('id', groupId)
  }
  return NextResponse.json({ ok: true })
}

// DELETE /api/roadmaps/[id] — удалить программу целиком (владелец).
// Порядок: назначения программы (+их попытки) → сама программа (каскадом
// снимаются темы и системная группа с её участниками).
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authorizeRoadmap(id)
  if ('error' in auth) return auth.error
  const { admin, groupId } = auth

  if (groupId) {
    const { data: asgns } = await admin.from('assignments').select('id').eq('group_id', groupId)
    await deleteAssignmentsDeep(admin, (asgns ?? []).map(a => a.id))
  }

  const { error } = await admin.from('roadmaps').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
