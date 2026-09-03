import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zUuid } from '@/lib/uuid'
import { createClient } from '@/lib/supabase/server'

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ожидается дата YYYY-MM-DD')

const postSchema = z.object({
  // Явный список дат
  days: z.array(isoDay).default([]),
  // Либо генерация по расписанию: дни недели + период
  pattern: z.object({
    // 0 = воскресенье … 6 = суббота (как Date.getDay)
    weekdays: z.array(z.number().int().min(0).max(6)).min(1),
    from: isoDay,
    weeks: z.number().int().min(1).max(52),
  }).optional(),
})

const deleteSchema = z.object({ day_id: zUuid() })

// Максимум дат за один запрос — 52 недели × 7 дней с запасом. Ограничение
// нужно, чтобы одним вызовом нельзя было забить журнал десятками тысяч строк.
const MAX_DAYS_PER_CALL = 400

async function requireJournal(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: journal } = await supabase
    .from('attendance_journals').select('id').eq('id', id).maybeSingle()
  if (!journal) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { supabase }
}

/**
 * Разворачивает расписание в список дат: начиная с недели, содержащей `from`,
 * берём указанные дни недели и повторяем `weeks` недель подряд.
 * Даты раньше `from` отбрасываем — иначе первая неделя «залезала» бы назад,
 * когда from приходится на середину недели.
 */
function expandPattern(weekdays: number[], from: string, weeks: number): string[] {
  const start = new Date(`${from}T00:00:00Z`)
  if (Number.isNaN(start.getTime())) return []

  // Понедельник недели, в которую попадает from (в UTC, без влияния часового пояса)
  const dow = start.getUTCDay()
  const mondayOffset = dow === 0 ? -6 : 1 - dow
  const monday = new Date(start)
  monday.setUTCDate(monday.getUTCDate() + mondayOffset)

  const wanted = [...new Set(weekdays)]
  const out: string[] = []

  for (let w = 0; w < weeks; w++) {
    for (const wd of wanted) {
      const d = new Date(monday)
      // понедельник = 1 … воскресенье = 0 → сдвиг от понедельника
      const shift = wd === 0 ? 6 : wd - 1
      d.setUTCDate(monday.getUTCDate() + w * 7 + shift)
      if (d < start) continue
      out.push(d.toISOString().slice(0, 10))
    }
  }
  return [...new Set(out)].sort()
}

// POST /api/attendance/[id]/days — добавить учебные дни.
// Либо явным списком (days), либо шаблоном расписания (pattern) — именно он
// закрывает «продублировать на N недель, чтобы не назначать каждый день».
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireJournal(id)
  if ('error' in auth) return auth.error
  const { supabase } = auth

  const parsed = postSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const list = [...parsed.data.days]
  if (parsed.data.pattern) {
    const { weekdays, from, weeks } = parsed.data.pattern
    list.push(...expandPattern(weekdays, from, weeks))
  }

  const unique = [...new Set(list)].sort()
  if (unique.length === 0) return NextResponse.json({ error: 'Не выбрано ни одной даты' }, { status: 400 })
  if (unique.length > MAX_DAYS_PER_CALL) {
    return NextResponse.json({ error: `Слишком много дат за раз (${unique.length}), максимум ${MAX_DAYS_PER_CALL}` }, { status: 400 })
  }

  // ignoreDuplicates: повторное применение шаблона поверх существующих дат —
  // штатный сценарий (добавить ещё месяц к тому же расписанию), не ошибка
  const { error } = await supabase
    .from('attendance_days')
    .upsert(unique.map(day => ({ journal_id: id, day })), {
      onConflict: 'journal_id,day',
      ignoreDuplicates: true,
    })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, requested: unique.length })
}

// DELETE /api/attendance/[id]/days — убрать день (отметки уходят каскадом)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireJournal(id)
  if ('error' in auth) return auth.error
  const { supabase } = auth

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { error } = await supabase
    .from('attendance_days').delete()
    .eq('id', parsed.data.day_id).eq('journal_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
