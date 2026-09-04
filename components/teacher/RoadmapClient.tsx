'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Plus, Route, Users, ListChecks } from 'lucide-react'
import { EditRoadmapDialog } from '@/components/teacher/EditRoadmapDialog'
import { AdminAuthorNotice } from '@/components/shared/AdminAuthorNotice'

export interface RoadmapRow {
  id: string
  title: string
  subject: string | null
  description: string | null
  topic_count: number
  student_count: number
}

export function RoadmapClient({ roadmaps }: { roadmaps: RoadmapRow[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', subject: '', description: '' })
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    setCreating(true)
    try {
      const res = await fetch('/api/roadmaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Ошибка создания'); return }
      toast.success('Программа создана')
      setOpen(false)
      router.push(`/teacher/roadmaps/${json.id}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Программы</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Учебные маршруты (road map): темы с прикреплёнными ДЗ и тестами для ваших учеников
          </p>
        </div>
        <Button onClick={() => { setForm({ title: '', subject: '', description: '' }); setOpen(true) }}>
          <Plus className="h-4 w-4 mr-2" />
          Создать программу
        </Button>
      </div>

      <AdminAuthorNotice what="программа" />

      {roadmaps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          <Route className="h-10 w-10 opacity-40" />
          <p>Пока нет программ. Создайте первую и добавьте темы с заданиями.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roadmaps.map(r => (
            <div key={r.id} className="relative">
              {/* Кнопка лежит НАД ссылкой-карточкой: вложить её в <Link> нельзя —
                  клик по кнопке уходил бы в переход на страницу программы */}
              <div className="absolute right-2 top-2 z-10">
                <EditRoadmapDialog
                  roadmapId={r.id}
                  title={r.title}
                  subject={r.subject}
                  description={r.description}
                />
              </div>
              <Link href={`/teacher/roadmaps/${r.id}`}>
              <Card className="h-full hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2 pr-9">
                    <CardTitle className="text-base leading-snug">{r.title}</CardTitle>
                    {r.subject && <Badge variant="secondary" className="shrink-0">{r.subject}</Badge>}
                  </div>
                  {r.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{r.description}</p>
                  )}
                </CardHeader>
                <CardContent className="flex items-center gap-4 text-xs text-muted-foreground pt-2">
                  <span className="flex items-center gap-1"><ListChecks className="h-3.5 w-3.5" />{r.topic_count} тем</span>
                  <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{r.student_count} учеников</span>
                </CardContent>
              </Card>
              </Link>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!v) setOpen(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Новая программа</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="rm-title">Название</Label>
              <Input id="rm-title" value={form.title}
                onChange={(e) => setForm(p => ({ ...p, title: e.target.value }))}
                placeholder="Математика, 8 класс" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rm-subject">Предмет <span className="text-muted-foreground text-xs">(для группировки у ученика)</span></Label>
              <Input id="rm-subject" value={form.subject}
                onChange={(e) => setForm(p => ({ ...p, subject: e.target.value }))}
                placeholder="Математика" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rm-desc">Описание <span className="text-muted-foreground text-xs">(необязательно)</span></Label>
              <Input id="rm-desc" value={form.description}
                onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>Отмена</Button>
            <Button onClick={handleCreate} disabled={creating || form.title.trim().length < 2}>
              {creating ? 'Создание...' : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
