import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { normalizeSubject } from '@/lib/doska/subjects'

// Заведение доски учителем:
//   POST { studentId, subject, title? }  → доска на одного ученика
//   POST { groupId,   subject, title? }  → доска на всю группу
// Ответ: { boardId, url, added }.
//
// Пришло на смену /api/teacher/doska-board, который висел на кнопке «Доска» в
// списке учеников. Тот работал по принципу «найди или заведи»: доска на пару
// была ровно одна, предмета у неё не было, и вести с учеником и алгебру, и
// физику на разных полотнах было нельзя. Здесь каждый вызов заводит новую
// доску, а различает их предмет.
//
// Кто чей ученик, проверяет не этот файл, а RLS: политика insert на
// doska_board_participants зовёт check_student_owned_by_auth, а группу отдаёт
// только её владельцу. Поэтому запись идёт клиентом самого учителя, без
// сервисного ключа: обойти правила отсюда нельзя даже по ошибке.

const newBoardId = () => 'b' + randomBytes(20).toString('base64url').slice(0, 10)

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const studentId = typeof body.studentId === 'string' ? body.studentId : ''
  const groupId = typeof body.groupId === 'string' ? body.groupId : ''
  const subject = normalizeSubject(body.subject)
  const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''

  if (!studentId && !groupId) return Response.json({ error: 'Не указан ученик или группа' }, { status: 400 })
  if (studentId && groupId) return Response.json({ error: 'Выберите ученика или группу, но не оба' }, { status: 400 })
  if (!subject) return Response.json({ error: 'Не указан предмет' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'teacher') {
    return Response.json({ error: 'Доступно только учителю' }, { status: 403 })
  }

  // Кого сажать за доску и как её назвать по умолчанию — единственное, чем
  // отличаются два случая. Дальше всё общее.
  let members: string[] = []
  let defaultTitle = ''

  if (groupId) {
    // Группу видно только её владельцу: чужая просто не найдётся.
    const { data: group } = await supabase
      .from('groups').select('id, name').eq('id', groupId).maybeSingle()
    if (!group) return Response.json({ error: 'Эта группа вам не принадлежит' }, { status: 403 })

    const { data: rows } = await supabase
      .from('group_members').select('user_id').eq('group_id', groupId)
    members = (rows ?? []).map(r => r.user_id as string)
    if (!members.length) return Response.json({ error: 'В группе нет учеников' }, { status: 400 })
    defaultTitle = `${group.name} · ${subject}`
  } else {
    const { data: student } = await supabase
      .from('profiles').select('full_name').eq('id', studentId).maybeSingle()
    if (!student) return Response.json({ error: 'Этот ученик не закреплён за вами' }, { status: 403 })
    members = [studentId]
    defaultTitle = `${student.full_name ?? 'Ученик'} · ${subject}`
  }

  // Название по умолчанию — «кто · предмет»: именно так доску ищут глазами и в
  // списке учителя, и в кабинете ученика.
  const title = (rawTitle || defaultTitle).slice(0, 80)

  const boardId = newBoardId()
  const { error: boardError } = await supabase
    .from('doska_boards')
    .insert({ id: boardId, owner_id: user.id, title, subject, group_id: groupId || null })
  if (boardError) {
    console.error('doska-boards: создание доски', boardError.message)
    return Response.json({ error: 'Не удалось создать доску' }, { status: 500 })
  }

  const { data: added, error: partError } = await supabase
    .from('doska_board_participants')
    .insert(members.map(id => ({ board_id: boardId, user_id: id, access: 'edit', added_by: user.id })))
    .select('user_id')

  // Политика отбила — значит кто-то из списка не закреплён за этим учителем.
  // Доска без участников осталась бы мусором, поэтому убираем её тем же мягким
  // способом, каким удаляем обычно.
  if (partError || !added?.length) {
    await supabase.from('doska_boards')
      .update({ deleted_at: new Date().toISOString() }).eq('id', boardId)
    return Response.json(
      { error: groupId ? 'В группе есть ученики не из вашего списка' : 'Этот ученик не закреплён за вами' },
      { status: 403 })
  }

  return Response.json({ boardId, url: '/api/doska/open?b=' + boardId, added: added.length })
}
