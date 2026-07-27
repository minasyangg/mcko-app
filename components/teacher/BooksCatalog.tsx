'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { BookOpen, Search, Loader2, X, Trash2 } from 'lucide-react'

export interface CatalogBook {
  id: string
  title: string
  authors: string | null
  book_type: string
  subject: string
  grade: string | null
  level: string | null
  problems: number | null
  answers_matched: number | null
  can_delete: boolean
}

interface ProblemHit {
  id: string
  book_id: string
  book_title: string
  book_subject: string | null
  book_grade: string | null
  task_number: string
  section_id: string | null
  snippet: string
}

const bookTypeLabel: Record<string, string> = {
  textbook: 'Учебник',
  problem_book: 'Задачник',
  workbook: 'Рабочая тетрадь',
  didactic: 'Дидактические материалы',
}

const ALL = '_all'

export function BooksCatalog({ books: initialBooks }: { books: CatalogBook[] }) {
  const router = useRouter()
  const [books, setBooks] = useState(initialBooks)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleDelete(book: CatalogBook) {
    setDeletingId(book.id)
    try {
      const res = await fetch(`/api/books/${book.id}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error ?? 'Ошибка удаления'); return }
      setBooks(prev => prev.filter(b => b.id !== book.id))
      toast.success(`Книга «${book.title}» удалена`)
      router.refresh()
    } finally {
      setDeletingId(null)
    }
  }

  // ── Фильтры каталога ──
  const [subject, setSubject] = useState(ALL)
  const [grade, setGrade] = useState(ALL)
  const [author, setAuthor] = useState('')

  const subjects = useMemo(
    () => [...new Set(books.map(b => b.subject).filter(Boolean))].sort(),
    [books],
  )
  const grades = useMemo(
    () => [...new Set(books.map(b => b.grade).filter(Boolean) as string[])]
      .sort((a, b) => a.localeCompare(b, 'ru', { numeric: true })),
    [books],
  )

  const filtered = useMemo(() => {
    const a = author.trim().toLowerCase()
    return books.filter(b =>
      (subject === ALL || b.subject === subject) &&
      (grade === ALL || b.grade === grade) &&
      (!a || (b.authors ?? '').toLowerCase().includes(a))
    )
  }, [books, subject, grade, author])

  const hasFilters = subject !== ALL || grade !== ALL || author.trim() !== ''

  // ── Общий поиск по заданиям всех книг ──
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<ProblemHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    const query = q.trim()
    if (query.length < 2) { setHits(null); setSearching(false); return }
    setSearching(true)
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/books/search-problems?q=${encodeURIComponent(query)}`)
        if (!res.ok) { setHits([]); return }
        const data = await res.json()
        setHits(data.results ?? [])
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [q])

  return (
    <div className="space-y-4">
      {/* Панель фильтров + общий поиск */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск задания по всем книгам: номер («735», «5.30») или текст"
            className="pl-8 h-9"
          />
          {q && (
            <button type="button" onClick={() => setQ('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Select value={subject} onValueChange={setSubject}>
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Предмет" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все предметы</SelectItem>
            {subjects.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={grade} onValueChange={setGrade}>
          <SelectTrigger className="w-32 h-9"><SelectValue placeholder="Класс" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все классы</SelectItem>
            {grades.map(g => <SelectItem key={g} value={g}>{g} класс</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="Автор"
          className="w-40 h-9"
        />
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-9 px-2 text-xs"
            onClick={() => { setSubject(ALL); setGrade(ALL); setAuthor('') }}>
            Сбросить
          </Button>
        )}
      </div>

      {/* Результаты поиска по заданиям (перекрывают каталог, пока введён запрос) */}
      {q.trim().length >= 2 ? (
        <div className="rounded-md border divide-y">
          {searching && (
            <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Поиск…
            </p>
          )}
          {!searching && (hits ?? []).length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Ничего не найдено.</p>
          )}
          {!searching && (hits ?? []).map(h => (
            <Link
              key={h.id}
              href={`/teacher/books/${h.book_id}?${new URLSearchParams({
                ...(h.section_id ? { section: h.section_id } : {}),
                task: h.task_number,
                pid: h.id,
              })}`}
              className="block px-4 py-3 hover:bg-muted/40 transition-colors"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="text-[11px] shrink-0">№ {h.task_number}</Badge>
                <span className="text-sm font-medium truncate">{h.book_title}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {[h.book_subject, h.book_grade ? `${h.book_grade} класс` : null].filter(Boolean).join(' · ')}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{h.snippet}</p>
            </Link>
          ))}
        </div>
      ) : (
        <>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3 text-muted-foreground">
              <BookOpen className="h-10 w-10" />
              <p>{books.length === 0 ? 'Книги ещё не загружены.' : 'Под фильтры не попала ни одна книга.'}</p>
              {books.length === 0 && (
                <p className="text-xs">Импорт выполняется локально: <code>node scripts/book-import.mjs &lt;file.json&gt;</code></p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(book => (
                <Link key={book.id} href={`/teacher/books/${book.id}`}>
                  <Card className="h-full hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <BookOpen className="h-8 w-8 text-primary/70 shrink-0" />
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge variant="outline" className="text-xs">
                            {bookTypeLabel[book.book_type] ?? book.book_type}
                          </Badge>
                          {book.can_delete && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => e.stopPropagation()}
                                  disabled={deletingId === book.id}
                                  title="Удалить книгу"
                                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                >
                                  {deletingId === book.id
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <Trash2 className="h-3.5 w-3.5" />}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Удалить книгу «{book.title}»?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Книга со всеми разделами, страницами и заданиями будет удалена безвозвратно.
                                    Задания, уже добавленные в тесты, там сохранятся.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={(e) => { e.preventDefault(); handleDelete(book) }}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Удалить
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </div>
                      <div>
                        <h2 className="font-medium leading-snug">{book.title}</h2>
                        {book.authors && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{book.authors}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{book.subject}</span>
                        {book.grade && <span>{book.grade} класс</span>}
                        {book.level && <span>{book.level}</span>}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground border-t pt-2">
                        {book.problems != null && <span>Заданий: <span className="font-medium text-foreground">{book.problems}</span></span>}
                        {book.answers_matched != null && book.answers_matched > 0 && (
                          <span>С ответами: <span className="font-medium text-foreground">{book.answers_matched}</span></span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
