import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Создаёт (или возвращает уже существующую) постоянную доску для пары
// учитель-ученик на отдельном приложении doska (canvas + WebSocket, своя
// файловая БД контента). Здесь хранится только привязка board_id к паре
// teacher_id/student_id — см. supabase/migrations/037_doska_student_boards.sql.
// Идентичность учителя в doska проверяется тем же Supabase access-токеном,
// который передаётся дальше в URL-фрагменте (#token=), без своего логина в doska.
export async function POST(req: Request) {
  const { studentId } = await req.json().catch(() => ({}))
  if (!studentId || typeof studentId !== 'string') {
    return Response.json({ error: 'Не указан ученик' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'teacher') {
    return Response.json({ error: 'Доступно только учителю' }, { status: 403 })
  }

  const { data: owned } = await supabase.rpc('check_student_owned_by_auth', { p_student_id: studentId })
  if (!owned) return Response.json({ error: 'Этот ученик не закреплён за вами' }, { status: 403 })

  const doskaUrl = process.env.DOSKA_URL
  if (!doskaUrl) return Response.json({ error: 'DOSKA_URL не настроен' }, { status: 500 })

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('doska_student_boards')
    .select('board_id')
    .eq('teacher_id', user.id)
    .eq('student_id', studentId)
    .maybeSingle()

  let boardId = existing?.board_id

  if (!boardId) {
    const { data: student } = await admin
      .from('profiles').select('full_name').eq('id', studentId).single()

    const created = await fetch(doskaUrl + '/api/boards/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: session.access_token, title: student?.full_name || 'Доска ученика' }),
    }).then(r => r.json().then(data => ({ ok: r.ok, data }))).catch(() => null)

    if (!created?.ok || !created.data?.board?.id) {
      return Response.json({ error: created?.data?.error || 'Не удалось создать доску' }, { status: 502 })
    }
    boardId = created.data.board.id as string

    const { error: insertError } = await admin
      .from('doska_student_boards')
      .insert({ teacher_id: user.id, student_id: studentId, board_id: boardId })

    if (insertError) {
      if (insertError.code === '23505') {
        const { data: race } = await admin
          .from('doska_student_boards')
          .select('board_id')
          .eq('teacher_id', user.id).eq('student_id', studentId)
          .maybeSingle()
        if (race?.board_id) boardId = race.board_id
        else return Response.json({ error: 'Не удалось сохранить привязку доски' }, { status: 500 })
      } else {
        return Response.json({ error: 'Не удалось сохранить привязку доски' }, { status: 500 })
      }
    }
  }

  const url = `${doskaUrl}/#b=${boardId}&token=${encodeURIComponent(session.access_token)}`
  return Response.json({ boardId, url })
}
