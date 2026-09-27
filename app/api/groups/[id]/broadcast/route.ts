import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { notifyTeacherBroadcast } from '@/lib/notifications/send'

type Params = { params: Promise<{ id: string }> }

// Разовая рассылка учителя всем (или части) участников группы/программы —
// не системное событие модуля уведомлений, инициируется вручную со страницы
// группы/программы. Владение группой проверяется тем же паттерном, что и
// members/route.ts (создатель группы или admin).
export async function POST(request: Request, { params }: Params) {
  const { id: groupId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id, full_name')
    .eq('id', user.id)
    .single()

  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: group } = await supabase
    .from('groups')
    .select('organization_id, created_by')
    .eq('id', groupId)
    .single()

  if (!group || group.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (profile.role !== 'admin' && group.created_by !== user.id) {
    return NextResponse.json({ error: 'Отправлять рассылку может только создатель группы или администратор' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as { message?: string; excludeStudentIds?: string[] } | null
  const message = body?.message?.trim()
  if (!message) return NextResponse.json({ error: 'Текст сообщения обязателен' }, { status: 400 })
  if (message.length > 3500) return NextResponse.json({ error: 'Сообщение слишком длинное (максимум 3500 символов)' }, { status: 400 })

  const { data: members } = await supabase
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId)

  const excluded = new Set(body?.excludeStudentIds ?? [])
  const studentIds = (members ?? []).map(m => m.user_id).filter(id => !excluded.has(id))

  if (studentIds.length === 0) {
    return NextResponse.json({ error: 'Нет получателей — все участники исключены или группа пуста' }, { status: 400 })
  }

  const result = await notifyTeacherBroadcast({
    orgId: profile.organization_id,
    studentIds,
    message,
    senderName: profile.full_name ?? 'учителя',
  })

  return NextResponse.json({ ok: true, ...result })
}
