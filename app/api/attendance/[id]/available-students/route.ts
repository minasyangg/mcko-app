import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/attendance/[id]/available-students?search=&grade=
//
// Кого можно добавить в ЭТОТ журнал: закреплённые за учителем ученики
// (RLS "profiles: teacher read own students" — admin видит всех в
// организации по "profiles: admin read org"), за вычетом уже стоящих в
// журнале строкой с student_id. Считается на сервере при каждом открытии
// диалога, а не статичным пропом страницы — список должен отражать состав
// ИМЕННО этого журнала на текущий момент, а не журнала, который учитель
// смотрел до перехода сюда.
//
// search — подстрока по ФИО (регистронезависимо), grade — точный класс.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // RLS: невидимый журнал = отсутствующий
  const { data: journal } = await supabase
    .from('attendance_journals').select('id').eq('id', id).maybeSingle()
  if (!journal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search')?.trim() ?? ''
  const grade = searchParams.get('grade')?.trim() ?? ''

  const [{ data: inJournalRows }, studentsQuery] = await Promise.all([
    supabase.from('attendance_students').select('student_id').eq('journal_id', id),
    (() => {
      let q = supabase
        .from('profiles')
        .select('id, full_name, grade')
        .eq('role', 'student')
        .is('deleted_at', null)
        .order('full_name')
      // RLS уже ограничивает видимость до своих учеников (учитель) или всей
      // организации (админ) — здесь только доп. фильтры по запросу клиента.
      if (search) q = q.ilike('full_name', `%${search}%`)
      if (grade) q = q.eq('grade', grade)
      return q
    })(),
  ])

  const { data: students, error } = studentsQuery
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const inJournal = new Set((inJournalRows ?? []).map(r => r.student_id).filter(Boolean))
  const available = (students ?? []).filter(s => !inJournal.has(s.id))

  // Список классов — для выпадающего фильтра. Считаем по ПОЛНОЙ видимой
  // выборке (без search/grade), иначе фильтр «сжимался» бы вслед за своим
  // же результатом и пропадал бы после первого выбора класса.
  const { data: allVisible } = await supabase
    .from('profiles').select('grade').eq('role', 'student').is('deleted_at', null)
  const grades = [...new Set((allVisible ?? []).map(s => s.grade).filter(Boolean))]
    .sort((a, b) => a!.localeCompare(b!, 'ru'))

  return NextResponse.json({ students: available, grades })
}
