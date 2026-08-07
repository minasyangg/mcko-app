import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'

// Кнопка «Доска» напротив ученика: открыть общую с ним доску, а если ещё ни
// одной нет — завести. Контракт для интерфейса прежний: POST { studentId } →
// { boardId, url }.
//
// Что изменилось внутри. Раньше привязка лежала в doska_student_boards с
// unique (teacher_id, student_id), то есть доска на пару была ровно одна, и
// создавалась она HTTP-вызовом к самой доске под проброшенным токеном. Теперь
// источник правды — doska_boards и doska_board_participants (041), запись идёт
// клиентом самого учителя, и всё разрешает RLS: политика insert на участников
// зовёт check_student_owned_by_auth, поэтому «свой ли это ученик» проверяет
// база, а не мы. Ни сервисный клиент, ни вызов к доске здесь больше не нужны —
// содержимое доска заведёт сама при первом открытии.
//
// Досок на пару может быть сколько угодно; открываем последнюю по изменению.

const newBoardId = () => 'b' + randomBytes(20).toString('base64url').slice(0, 10)

export async function POST(req: Request) {
  const { studentId } = await req.json().catch(() => ({}))
  if (!studentId || typeof studentId !== 'string') {
    return Response.json({ error: 'Не указан ученик' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, full_name').eq('id', user.id).single()
  if (!profile || profile.role !== 'teacher') {
    return Response.json({ error: 'Доступно только учителю' }, { status: 403 })
  }

  // Уже есть доска с этим учеником?
  const { data: existing } = await supabase
    .from('doska_board_participants')
    .select('board_id, doska_boards!inner(id, owner_id, updated_at, deleted_at)')
    .eq('user_id', studentId)
    .eq('doska_boards.owner_id', user.id)
    .is('doska_boards.deleted_at', null)
    .order('updated_at', { referencedTable: 'doska_boards', ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing?.board_id) {
    return Response.json({ boardId: existing.board_id, url: '/api/doska/open?b=' + existing.board_id })
  }

  const { data: student } = await supabase
    .from('profiles').select('full_name').eq('id', studentId).maybeSingle()
  if (!student) {
    return Response.json({ error: 'Этот ученик не закреплён за вами' }, { status: 403 })
  }

  const boardId = newBoardId()
  const { error: boardError } = await supabase
    .from('doska_boards')
    .insert({ id: boardId, owner_id: user.id, title: student.full_name || 'Доска ученика' })
  if (boardError) {
    console.error('doska-board: создание доски', boardError.message)
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
