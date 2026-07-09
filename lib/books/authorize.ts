import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export type BookEditAuthOk = {
  error?: undefined
  admin: AdminClient
  userId: string
  role: 'teacher' | 'admin'
}

export type BookEditAuth = { error: Response } | BookEditAuthOk

// Единый допуск к редактированию книги (используется всеми write-роутами
// модуля книг): admin — любая книга, teacher — своя (books.created_by)
// или чужая с точечным грантом от админа (book_editors).
export async function authorizeBookEdit(
  bookId: string,
  message = 'Редактировать может только владелец книги, учитель с доступом или администратор'
): Promise<BookEditAuth> {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const admin = createAdminClient()
  const { data: book } = await admin
    .from('books').select('id, created_by').eq('id', bookId).single()
  if (!book) {
    return { error: Response.json({ error: 'Book not found' }, { status: 404 }) }
  }

  let allowed = profile.role === 'admin' || book.created_by === user.id
  if (!allowed) {
    const { data: grant } = await admin
      .from('book_editors')
      .select('teacher_id')
      .eq('book_id', bookId)
      .eq('teacher_id', user.id)
      .maybeSingle()
    allowed = !!grant
  }

  if (!allowed) {
    return { error: Response.json({ error: message }, { status: 403 }) }
  }

  return { admin, userId: user.id, role: profile.role as 'teacher' | 'admin' }
}

// Допуск к УДАЛЕНИЮ книги целиком: admin, владелец (books.created_by) или
// учитель с грантом, у которого can_delete = true. Отдельно от authorizeBookEdit,
// т.к. право удалять — более узкое, чем право редактировать.
export async function authorizeBookDelete(
  bookId: string,
  message = 'Удалить книгу может только владелец, учитель с правом удаления или администратор'
): Promise<BookEditAuth> {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const admin = createAdminClient()
  const { data: book } = await admin
    .from('books').select('id, created_by').eq('id', bookId).single()
  if (!book) {
    return { error: Response.json({ error: 'Book not found' }, { status: 404 }) }
  }

  let allowed = profile.role === 'admin' || book.created_by === user.id
  if (!allowed) {
    const { data: grant } = await admin
      .from('book_editors')
      .select('can_delete')
      .eq('book_id', bookId)
      .eq('teacher_id', user.id)
      .maybeSingle()
    allowed = !!grant?.can_delete
  }

  if (!allowed) {
    return { error: Response.json({ error: message }, { status: 403 }) }
  }

  return { admin, userId: user.id, role: profile.role as 'teacher' | 'admin' }
}
