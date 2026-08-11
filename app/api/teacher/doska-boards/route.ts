import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { normalizeSubject } from '@/lib/doska/subjects'

// Заведение доски учителем: POST { studentId, subject, title? } → { boardId, url }.
//
// Пришло на смену /api/teacher/doska-board, который висел на кнопке «Доска» в
// списке учеников. Тот работал по принципу «найди или заведи»: доска на пару
// была ровно одна, предмета у неё не было, и вести с учеником и алгебру, и
// физику на разных полотнах было нельзя. Здесь каждый вызов заводит новую
// доску, а различает их предмет.
//
// Кто чей ученик, проверяет не этот файл, а RLS: политика insert на
// doska_board_participants зовёт check_student_owned_by_auth. Поэтому запись
// идёт клиентом самого учителя, без сервисного ключа.

const newBoardId = () => 'b' + randomBytes(20).toString('base64url').slice(0, 10)

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const studentId = typeof body.studentId === 'string' ? body.studentId : ''
  const subject = normalizeSubject(body.subject)
  const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''

  if (!studentId) return Response.json({ error: 'Не указан ученик' }, { status: 400 })
  if (!subject) return Response.json({ error: 'Не указан предмет' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'teacher') {
    return Response.json({ error: 'Доступно только учителю' }, { status: 403 })
  }

  const { data: student } = await supabase
    .from('profiles').select('full_name').eq('id', studentId).maybeSingle()
  if (!student) return Response.json({ error: 'Этот ученик не закреплён за вами' }, { status: 403 })

  // Название по умолчанию — «ученик · предмет»: именно так доску ищут глазами
  // и в списке учителя, и в кабинете ученика.
  const title = (rawTitle || `${student.full_name ?? 'Ученик'} · ${subject}`).slice(0, 80)

  const boardId = newBoardId()
  const { error: boardError } = await supabase
    .from('doska_boards')
    .insert({ id: boardId, owner_id: user.id, title, subject })
  if (boardError) {
    console.error('doska-boards: создание доски', boardError.message)
    return Response.json({ error: 'Не удалось создать доску' }, { status: 500 })
  }

  const { error: partError } = await supabase
    .from('doska_board_participants')
    .insert({ board_id: boardId, user_id: studentId, access: 'edit', added_by: user.id })
  if (partError) {
    // Политика отбила — значит ученик не закреплён за этим учителем. Доска без
    // участников осталась бы мусором, поэтому убираем её тем же мягким способом.
    await supabase.from('doska_boards')
      .update({ deleted_at: new Date().toISOString() }).eq('id', boardId)
    return Response.json({ error: 'Этот ученик не закреплён за вами' }, { status: 403 })
  }

  return Response.json({ boardId, url: '/api/doska/open?b=' + boardId })
}
