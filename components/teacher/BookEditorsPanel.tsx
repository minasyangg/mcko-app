'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { UserCog, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

interface TeacherOption {
  id: string
  full_name: string
}

interface Props {
  bookId: string
  // Учителя организации (без владельца книги — у него доступ и так есть)
  teachers: TeacherOption[]
  // teacher_id учителей, у которых уже есть грант
  grantedIds: string[]
}

// Блок «Доступ на редактирование» на странице книги. Виден только админу
// (страница передаёт его в BookReader только для role==='admin').
// Грант/отзыв — через /api/books/[id]/editors (запись service role).
export function BookEditorsPanel({ bookId, teachers, grantedIds: initialGranted }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [granted, setGranted] = useState<Set<string>>(new Set(initialGranted))
  const [busy, setBusy] = useState<string | null>(null)

  async function toggle(teacher: TeacherOption) {
    const has = granted.has(teacher.id)
    setBusy(teacher.id)
    try {
      const res = has
        ? await fetch(`/api/books/${bookId}/editors?teacher_id=${teacher.id}`, { method: 'DELETE' })
        : await fetch(`/api/books/${bookId}/editors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teacher_id: teacher.id }),
          })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? 'Ошибка изменения доступа')
        return
      }
      setGranted(prev => {
        const next = new Set(prev)
        if (has) next.delete(teacher.id)
        else next.add(teacher.id)
        return next
      })
      toast.success(has
        ? `Доступ отозван: ${teacher.full_name}`
        : `Доступ выдан: ${teacher.full_name}`)
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="border-b px-4 py-2 shrink-0">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <UserCog className="h-3.5 w-3.5" />
        Доступ на редактирование
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {teachers.length === 0 ? (
            <p className="text-xs text-muted-foreground">Нет учителей в организации.</p>
          ) : (
            teachers.map(t => {
              const has = granted.has(t.id)
              return (
                <div key={t.id} className="flex items-center justify-between gap-2">
                  <span className="text-xs truncate" title={t.full_name}>{t.full_name}</span>
                  <Button
                    size="sm"
                    variant={has ? 'secondary' : 'outline'}
                    className="h-6 px-2 text-[11px] shrink-0"
                    disabled={busy === t.id}
                    onClick={() => toggle(t)}
                  >
                    {busy === t.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : has ? 'Отозвать' : 'Выдать'}
                  </Button>
                </div>
              )
            })
          )}
          <p className="text-[11px] leading-snug text-muted-foreground pt-1">
            Учитель с доступом может править текст и задания этой книги.
            Остальным книга доступна только для чтения и добавления заданий в тест.
          </p>
        </div>
      )}
    </div>
  )
}
