'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ConfirmDeleteAction } from '@/components/shared/ConfirmDeleteAction'
import { Plus, ClipboardCheck, Trash2 } from 'lucide-react'
import { AdminAuthorNotice } from '@/components/shared/AdminAuthorNotice'

export interface JournalRow {
  id: string
  title: string
  subject: string | null
  created_at: string | null
}

export function AttendanceListClient({ journals }: { journals: JournalRow[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!title.trim()) { toast.error('Введите название'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), subject: subject.trim() || null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка создания'); return }
      setOpen(false)
      router.push(`/teacher/attendance/${json.id}`)
    } finally { setBusy(false) }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/attendance/${id}`, { method: 'DELETE' })
    if (!res.ok) { toast.error('Не удалось удалить'); return }
    toast.success('Журнал удалён')
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Посещение</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Журналы посещаемости: ученики, учебные дни и отметки
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Создать журнал</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Новый журнал</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label htmlFor="j-title">Название *</Label>
                <Input
                  id="j-title" value={title} autoFocus maxLength={200}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Например: 8А, математика"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="j-subject">Предмет</Label>
                <Input
                  id="j-subject" value={subject} maxLength={100}
                  onChange={e => setSubject(e.target.value)}
                  placeholder="Необязательно"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Отмена</Button>
              <Button onClick={create} disabled={busy || !title.trim()}>
                {busy ? 'Создание...' : 'Создать'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <AdminAuthorNotice what="журнал" />

      {journals.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
          <ClipboardCheck className="h-10 w-10 opacity-40" />
          <p>Журналов пока нет. Создайте первый.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {journals.map(j => (
            <div key={j.id} className="relative">
              {/* Удаление поверх карточки-ссылки: вложить кнопку в <Link> нельзя */}
              <div className="absolute right-2 top-2 z-10">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Удалить журнал «{j.title}»?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Ученики, учебные дни и все отметки этого журнала будут удалены безвозвратно.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Отмена</AlertDialogCancel>
                      <ConfirmDeleteAction onConfirm={() => remove(j.id)} />
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              <Link href={`/teacher/attendance/${j.id}`}>
                <Card className="h-full cursor-pointer transition-all hover:border-primary/50 hover:shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="pr-9 text-base leading-snug">{j.title}</CardTitle>
                    {j.subject && <p className="text-sm text-muted-foreground">{j.subject}</p>}
                  </CardHeader>
                  <CardContent className="pt-2 text-xs text-muted-foreground">
                    {j.created_at ? `Создан ${new Date(j.created_at).toLocaleDateString('ru-RU')}` : ''}
                  </CardContent>
                </Card>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
