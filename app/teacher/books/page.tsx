import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ShieldCheck } from 'lucide-react'
import { BooksCatalog, type CatalogBook } from '@/components/teacher/BooksCatalog'
import { AddTargetBanner } from '@/components/teacher/AddTargetBanner'

export default async function BooksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  const isAdmin = profile?.role === 'admin'

  const { data: books } = await supabase
    .from('books')
    .select('id, title, authors, book_type, subject, grade, level, page_count, created_by')
    .eq('is_active', true)
    .order('subject')
    .order('grade')
    .order('title')

  // Живой подсчёт заданий/ответов из book_problems — import_meta.answers_matched
  // это снимок на момент импорта и не учитывает ответы, добавленные позже
  // (кнопка «Ответ ИИ», book-answer-reviewer, ручной ввод).
  const { data: problemStats } = await supabase
    .from('book_problems')
    .select('book_id, answer_source')
    .eq('is_active', true)
    .limit(50000)
  const statsByBook = new Map<string, { problems: number; answers: number }>()
  for (const p of problemStats ?? []) {
    const s = statsByBook.get(p.book_id) ?? { problems: 0, answers: 0 }
    s.problems++
    if (p.answer_source !== 'none') s.answers++
    statsByBook.set(p.book_id, s)
  }

  let deletableIds = new Set<string>()
  if (!isAdmin) {
    const { data: grants } = await supabase
      .from('book_editors')
      .select('book_id')
      .eq('teacher_id', user.id)
      .eq('can_delete', true)
    deletableIds = new Set((grants ?? []).map(g => g.book_id))
  }

  const catalog: CatalogBook[] = (books ?? []).map(b => {
    const stats = statsByBook.get(b.id)
    return {
      id: b.id,
      title: b.title,
      authors: b.authors,
      book_type: b.book_type,
      subject: b.subject,
      grade: b.grade,
      level: b.level,
      problems: stats?.problems ?? null,
      answers_matched: stats?.answers ?? null,
      can_delete: isAdmin || b.created_by === user.id || deletableIds.has(b.id),
    }
  })

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      <AddTargetBanner />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Книги</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Учебники и задачники — база заданий для домашних работ и тестов
          </p>
        </div>
        {isAdmin && (
          <Button asChild variant="outline" size="sm">
            <Link href="/teacher/books/permissions">
              <ShieldCheck className="h-4 w-4 mr-1.5" />
              Права доступа
            </Link>
          </Button>
        )}
      </div>

      <BooksCatalog books={catalog} />
    </div>
  )
}
