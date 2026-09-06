import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'
import { createClient } from '@/lib/supabase/server'

const postSchema = z.object({
  // Ученики сайта — списком id; «внешние» дети, которых нет в системе, — по ФИО
  student_ids: z.array(zUuid()).default([]),
  names: z.array(z.string().trim().min(1).max(200)).default([]),
})

const deleteSchema = z.object({ row_id: zUuid() })

async function requireJournal(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  // RLS: невидимый журнал = отсутствующий
  const { data: journal } = await supabase
    .from('attendance_journals').select('id').eq('id', id).maybeSingle()
  if (!journal) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { supabase }
}

// POST /api/attendance/[id]/students — добавить строки в журнал.
// Ученики сайта добавляются по id (их ФИО берём из profiles, чтобы в журнале
// стояло актуальное имя), произвольные — по введённому ФИО.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireJournal(id)
  if ('error' in auth) return auth.error
  const { supabase } = auth

  const parsed = postSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { student_ids, names } = parsed.data
  if (student_ids.length === 0 && names.length === 0) {
    return NextResponse.json({ error: 'Некого добавлять' }, { status: 400 })
  }

  // Текущий максимум sort_order, чтобы новые строки легли в конец
  const { data: last } = await supabase
    .from('attendance_students').select('sort_order')
    .eq('journal_id', id).order('sort_order', { ascending: false }).limit(1).maybeSingle()
  let order = (last?.sort_order ?? -1) + 1

  const rows: { journal_id: string; student_id: string | null; full_name: string; sort_order: number }[] = []

  if (student_ids.length > 0) {
    // ФИО берём из БД, а не с клиента: имя в журнале должно совпадать с
    // профилем. Видимость профилей ограничена RLS ("profiles: teacher read
    // own students" / "admin read org") — чужого ученика тут не окажется
    // вообще, даже если id пришёл в запросе: строки просто не будет в ответе,
    // и она молча не попадёт в rows ниже.
    const { data: profiles } = await supabase
      .from('profiles').select('id, full_name').in('id', student_ids)
    for (const p of profiles ?? []) {
      rows.push({ journal_id: id, student_id: p.id, full_name: p.full_name ?? 'Ученик', sort_order: order++ })
    }
  }

  for (const name of names) {
    rows.push({ journal_id: id, student_id: null, full_name: name, sort_order: order++ })
  }

  if (rows.length === 0) return NextResponse.json({ error: 'Некого добавлять' }, { status: 400 })

  // ignoreDuplicates: повторное добавление того же ученика сайта не должно
  // падать ошибкой — просто ничего не меняем (unique journal_id+student_id)
  const { error } = await supabase
    .from('attendance_students')
    .upsert(rows, { onConflict: 'journal_id,student_id', ignoreDuplicates: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, added: rows.length })
}

// DELETE /api/attendance/[id]/students — убрать строку (отметки уходят каскадом)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireJournal(id)
  if ('error' in auth) return auth.error
  const { supabase } = auth

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { error } = await supabase
    .from('attendance_students').delete()
    .eq('id', parsed.data.row_id).eq('journal_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
