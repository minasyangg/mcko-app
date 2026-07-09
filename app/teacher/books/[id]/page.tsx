import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect, notFound } from 'next/navigation'
import { BookReader } from '@/components/teacher/BookReader'
import { BookEditorsPanel } from '@/components/teacher/BookEditorsPanel'

export default async function BookPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: book } = await supabase
    .from('books')
    .select('id, title, authors, book_type, subject, grade, level, page_count, created_by')
    .eq('id', id)
    .eq('is_active', true)
    .single()

  if (!book) notFound()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'

  // Править книгу может загрузивший её пользователь, администратор
  // или учитель с точечным грантом (book_editors, выдаёт админ).
  // Удалять — владелец/админ/грант с can_delete.
  const isOwner = book.created_by === user.id
  let canEdit = isAdmin || isOwner
  let canDelete = isAdmin || isOwner
  if (!canEdit) {
    const { data: grant } = await supabase
      .from('book_editors')
      .select('teacher_id, can_delete')
      .eq('book_id', id)
      .eq('teacher_id', user.id)
      .maybeSingle()
    canEdit = !!grant
    canDelete = !!grant?.can_delete
  }

  const { data: sections } = await supabase
    .from('book_sections')
    .select('id, parent_id, kind, number, title, page_start, page_end, sort_order')
    .eq('book_id', id)
    .order('sort_order')

  // Админ управляет грантами на редактирование книги
  let editorsPanel: React.ReactNode = null
  if (isAdmin && profile?.organization_id) {
    const admin = createAdminClient()
    const [{ data: teachers }, { data: grants }] = await Promise.all([
      admin
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'teacher')
        .eq('organization_id', profile.organization_id)
        .order('full_name'),
      admin
        .from('book_editors')
        .select('teacher_id')
        .eq('book_id', id),
    ])
    editorsPanel = (
      <BookEditorsPanel
        bookId={id}
        teachers={(teachers ?? []).filter(t => t.id !== book.created_by)}
        grantedIds={(grants ?? []).map(g => g.teacher_id)}
      />
    )
  }

  return (
    <BookReader
      book={book}
      sections={sections ?? []}
      canEdit={canEdit}
      canDelete={canDelete}
      editorsPanel={editorsPanel}
    />
  )
}
