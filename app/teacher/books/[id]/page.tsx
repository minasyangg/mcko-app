import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { BookReader } from '@/components/teacher/BookReader'

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
    .select('role')
    .eq('id', user.id)
    .single()

  // Править книгу может только загрузивший её пользователь или администратор
  const canEdit = profile?.role === 'admin' || book.created_by === user.id

  const { data: sections } = await supabase
    .from('book_sections')
    .select('id, parent_id, kind, number, title, page_start, page_end, sort_order')
    .eq('book_id', id)
    .order('sort_order')

  return <BookReader book={book} sections={sections ?? []} canEdit={canEdit} />
}
