import { authorizeBookDelete } from '@/lib/books/authorize'
import { NextRequest } from 'next/server'

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
