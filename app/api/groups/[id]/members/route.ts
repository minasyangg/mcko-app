import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Params) {
  const { id: groupId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
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

  // Owner-чек: учитель управляет составом только своих групп
  if (profile.role !== 'admin' && group.created_by !== user.id) {
    return NextResponse.json({ error: 'Изменять состав может только создатель группы или администратор' }, { status: 403 })
  }

  const body = await request.json()
  const userId = body?.user_id as string | undefined
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  // Учитель добавляет только закреплённых за ним учеников — по M:N
  // teacher_students (миграция 019), не по одиночному created_by.
  // (RLS with check подстрахует на уровне БД, но отдаём внятную ошибку заранее)
  if (profile.role !== 'admin') {
    const { data: link } = await supabase
      .from('teacher_students')
      .select('student_id')
      .eq('teacher_id', user.id)
      .eq('student_id', userId)
      .maybeSingle()
    if (!link) {
      return NextResponse.json({ error: 'Можно добавлять только своих учеников' }, { status: 403 })
    }
  }

  const { error } = await supabase
    .from('group_members')
    .insert({ group_id: groupId, user_id: userId })

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Already a member' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request, { params }: Params) {
  const { id: groupId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
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
    return NextResponse.json({ error: 'Изменять состав может только создатель группы или администратор' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('user_id')
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
