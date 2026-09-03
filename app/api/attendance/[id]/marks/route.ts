import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'
import { createClient } from '@/lib/supabase/server'

const STATUSES = ['present', 'absent', 'sick', 'holiday'] as const

const putSchema = z.object({
  marks: z.array(z.object({
    student_id: zUuid(),
    day_id: zUuid(),
    // null — снять отметку (пустая клетка отличается от «выходного»)
    status: z.enum(STATUSES).nullable(),
  })).min(1).max(500),
})

// PUT /api/attendance/[id]/marks — проставить отметки пачкой.
// Пачкой, а не по одной: колонку/строку целиком («весь день выходной»,
// «ученик болел всю неделю») заполняют одним действием, и это не должно
// превращаться в 30 запросов.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // RLS: невидимый журнал = отсутствующий
  const { data: journal } = await supabase
    .from('attendance_journals').select('id').eq('id', id).maybeSingle()
  if (!journal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = putSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const toClear = parsed.data.marks.filter(m => m.status === null)
  const toSet = parsed.data.marks.filter(m => m.status !== null)

  // Проверяем, что все строки/дни принадлежат этому журналу: RLS пустила бы
  // запись и с чужим student_id, если бы тот журнал тоже был доступен админу.
  const studentIds = [...new Set(parsed.data.marks.map(m => m.student_id))]
  const dayIds = [...new Set(parsed.data.marks.map(m => m.day_id))]

  const [{ data: okStudents }, { data: okDays }] = await Promise.all([
    supabase.from('attendance_students').select('id').eq('journal_id', id).in('id', studentIds),
    supabase.from('attendance_days').select('id').eq('journal_id', id).in('id', dayIds),
  ])

  const validStudents = new Set((okStudents ?? []).map(s => s.id))
  const validDays = new Set((okDays ?? []).map(d => d.id))
  if (validStudents.size !== studentIds.length || validDays.size !== dayIds.length) {
    return NextResponse.json({ error: 'Строка или день не из этого журнала' }, { status: 400 })
  }

  if (toSet.length > 0) {
    const { error } = await supabase.from('attendance_marks').upsert(
      toSet.map(m => ({
        journal_id: id,
        student_id: m.student_id,
        day_id: m.day_id,
        status: m.status as (typeof STATUSES)[number],
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'student_id,day_id' },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Снятие отметки — удаление строки, чтобы «пусто» не хранилось как статус
  for (const m of toClear) {
    const { error } = await supabase.from('attendance_marks').delete()
      .eq('journal_id', id).eq('student_id', m.student_id).eq('day_id', m.day_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, saved: toSet.length, cleared: toClear.length })
}
