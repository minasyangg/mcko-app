'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ChevronDown, ChevronRight, Trash2, BookOpen, Loader2 } from 'lucide-react'

interface Grant { teacher_id: string; can_delete: boolean }
interface BookRow {
  id: string
  title: string
  authors: string | null
  book_type: string
  owner_id: string | null
  owner_name: string | null
  grants: Grant[]
}
interface TeacherOption { id: string; full_name: string }

const bookTypeLabel: Record<string, string> = {
  textbook: 'Учебник', problem_book: 'Задачник',
  workbook: 'Рабочая тетрадь', didactic: 'Дидактические материалы',
}

export function BookPermissionsClient({ books: initial, teachers }: { books: BookRow[]; teachers: TeacherOption[] }) {
  const router = useRouter()
  const [books, setBooks] = useState(initial)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // `${bookId}:${teacherId}`

  function grantOf(book: BookRow, teacherId: string): Grant | undefined {
    return book.grants.find(g => g.teacher_id === teacherId)
  }

  // Обновить грант локально
  function setGrant(bookId: string, teacherId: string, next: Grant | null) {
    setBooks(prev => prev.map(b => {
      if (b.id !== bookId) return b
      const rest = b.grants.filter(g => g.teacher_id !== teacherId)
      return { ...b, grants: next ? [...rest, next] : rest }
    }))
  }

  async function toggleEdit(book: BookRow, teacher: TeacherOption) {
    const has = !!grantOf(book, teacher.id)
    setBusy(`${book.id}:${teacher.id}`)
    try {
      const res = has
        ? await fetch(`/api/books/${book.id}/editors?teacher_id=${teacher.id}`, { method: 'DELETE' })
        : await fetch(`/api/books/${book.id}/editors`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teacher_id: teacher.id, can_delete: false }),
          })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка'); return }
      setGrant(book.id, teacher.id, has ? null : { teacher_id: teacher.id, can_delete: false })
      toast.success(has ? `Редактирование отозвано: ${teacher.full_name}` : `Редактирование выдано: ${teacher.full_name}`)
      router.refresh()
    } finally { setBusy(null) }
  }

  async function toggleDelete(book: BookRow, teacher: TeacherOption) {
    const g = grantOf(book, teacher.id)
    if (!g) return // удаление доступно только при наличии редактирования
    const next = !g.can_delete
    setBusy(`${book.id}:${teacher.id}`)
    try {
      const res = await fetch(`/api/books/${book.id}/editors`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher_id: teacher.id, can_delete: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка'); return }
      setGrant(book.id, teacher.id, { teacher_id: teacher.id, can_delete: next })
      toast.success(next ? `Удаление разрешено: ${teacher.full_name}` : `Удаление запрещено: ${teacher.full_name}`)
      router.refresh()
    } finally { setBusy(null) }
  }

  async function deleteBook(book: BookRow) {
    setBusy(`del:${book.id}`)
    try {
      const res = await fetch(`/api/books/${book.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка удаления'); return }
      setBooks(prev => prev.filter(b => b.id !== book.id))
      toast.success(`Книга «${book.title}» удалена`)
      router.refresh()
    } finally { setBusy(null) }
  }

  if (books.length === 0) {
    return <p className="text-sm text-muted-foreground py-10 text-center">Книги ещё не загружены.</p>
  }

  return (
    <div className="space-y-2">
      {books.map(book => {
        const open = openId === book.id
        const grantCount = book.grants.length
        return (
          <div key={book.id} className="rounded-md border">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <button type="button" onClick={() => setOpenId(open ? null : book.id)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left">
                {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                <BookOpen className="h-4 w-4 text-primary/70 shrink-0" />
                <span className="font-medium truncate">{book.title}</span>
                <Badge variant="outline" className="text-[11px] shrink-0">{bookTypeLabel[book.book_type] ?? book.book_type}</Badge>
                {grantCount > 0 && (
                  <span className="text-xs text-muted-foreground shrink-0">доступ: {grantCount}</span>
                )}
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                    disabled={busy === `del:${book.id}`} title="Удалить книгу">
                    {busy === `del:${book.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Удалить книгу «{book.title}»?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Книга со всеми разделами, страницами и заданиями будет удалена безвозвратно.
                      Задания, уже добавленные в тесты, там сохранятся.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteBook(book)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Удалить
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            {open && (
              <div className="border-t px-3 py-2">
                {book.owner_name && (
                  <p className="text-xs text-muted-foreground mb-2">
                    Владелец (загрузил): <span className="text-foreground">{book.owner_name}</span> — редактирует и удаляет всегда.
                  </p>
                )}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="text-left font-medium py-1">Учитель</th>
                      <th className="text-center font-medium py-1 w-32">Редактирование</th>
                      <th className="text-center font-medium py-1 w-28">Удаление</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teachers.filter(t => t.id !== book.owner_id).length === 0 && (
                      <tr><td colSpan={3} className="py-4 text-center text-muted-foreground text-xs">Нет других учителей</td></tr>
                    )}
                    {teachers.filter(t => t.id !== book.owner_id).map(t => {
                      const g = grantOf(book, t.id)
                      const b = busy === `${book.id}:${t.id}`
                      return (
                        <tr key={t.id} className="border-t">
                          <td className="py-1.5">{t.full_name}</td>
                          <td className="text-center">
                            <Button size="sm" variant={g ? 'secondary' : 'outline'} className="h-6 px-2 text-[11px]"
                              disabled={b} onClick={() => toggleEdit(book, t)}>
                              {b ? <Loader2 className="h-3 w-3 animate-spin" /> : g ? 'Разрешено' : 'Выдать'}
                            </Button>
                          </td>
                          <td className="text-center">
                            <Button size="sm" variant={g?.can_delete ? 'secondary' : 'outline'} className="h-6 px-2 text-[11px]"
                              disabled={b || !g} onClick={() => toggleDelete(book, t)}
                              title={!g ? 'Сначала выдайте редактирование' : ''}>
                              {g?.can_delete ? 'Разрешено' : 'Нет'}
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
