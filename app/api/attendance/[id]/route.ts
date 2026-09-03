import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  subject: z.string().trim().max(100).nullable().optional(),
})

// Доступ к журналу целиком на RLS (attendance_journals: owner or admin) —
// если строка не видна, значит журнала для этого пользователя не существует.
async function loadJournal(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: journal } = await supabase
    .from('attendance_journals')
    .select('id, title, subject, created_by')
    .eq('id', id)
    .maybeSingle()

  if (!journal) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { supabase, journal }
}

// GET /api/attendance/[id] — журнал целиком: ученики, дни, отметки
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await loadJournal(id)
  if ('error' in auth) return auth.error
  const { supabase, journal } = auth

  const [{ data: students }, { data: days }, { data: marks }] = await Promise.all([
    supabase.from('attendance_students')
      .select('id, student_id, full_name, sort_order')
      .eq('journal_id', id).order('sort_order').order('full_name'),
    supabase.from('attendance_days')
      .select('id, day, note').eq('journal_id', id).order('day'),
    supabase.from('attendance_marks')
      .select('student_id, day_id, status').eq('journal_id', id),
  ])

  return NextResponse.json({
    journal,
    students: students ?? [],
    days: days ?? [],
    marks: marks ?? [],
  })
}

// PATCH /api/attendance/[id] — переименовать журнал
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await loadJournal(id)
  if ('error' in auth) return auth.error
  const { supabase } = auth

  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const patch: { title?: string; subject?: string | null } = {}
  if (parsed.data.title !== undefined) patch.title = parsed.data.title
  if (parsed.data.subject !== undefined) patch.subject = parsed.data.subject || null
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })

  const { error } = await supabase.from('attendance_journals').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/attendance/[id] — удалить журнал (ученики/дни/отметки уходят каскадом)
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await loadJournal(id)
  if ('error' in auth) return auth.error
  const { supabase } = auth

  const { error } = await supabase.from('attendance_journals').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
