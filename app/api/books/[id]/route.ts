import { authorizeBookDelete, authorizeBookEdit } from '@/lib/books/authorize'
import { NextRequest } from 'next/server'

// PATCH /api/books/[id] — правка метаданных книги (заголовок/авторы).
// Body: { title?, authors? } — оба поля опциональны, обновляются только
// переданные. title не может стать пустым, authors можно очистить (null).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: bookId } = await params

  const auth = await authorizeBookEdit(bookId)
  if (auth.error) return auth.error
  const admin = auth.admin

  const body = await request.json() as { title?: string; authors?: string | null }
  const update: { title?: string; authors?: string | null } = {}

  if (body.title !== undefined) {
    const title = body.title.trim()
    if (!title) return Response.json({ error: 'Название не может быть пустым' }, { status: 400 })
    if (title.length > 300) return Response.json({ error: 'Слишком длинное название' }, { status: 400 })
    update.title = title
  }
  if (body.authors !== undefined) {
    const authors = body.authors?.trim() ?? null
    if (authors && authors.length > 300) return Response.json({ error: 'Слишком длинное поле авторов' }, { status: 400 })
    update.authors = authors || null
  }
  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'Нечего обновлять' }, { status: 400 })
  }

  const { error } = await admin.from('books').update(update).eq('id', bookId)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}

// DELETE /api/books/[id] — удаление книги целиком.
// Владелец (books.created_by), учитель с грантом can_delete или admin.
// Дочерние book_sections/book_pages/book_problems удаляются каскадом (FK
// on delete cascade); в тестах, куда задания книги уже добавлены, их копии
// сохраняются (test_tasks.book_problem_id → set null при удалении задания).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: bookId } = await params

  const auth = await authorizeBookDelete(bookId)
  if (auth.error) return auth.error
  const admin = auth.admin

  const { error } = await admin.from('books').delete().eq('id', bookId)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
