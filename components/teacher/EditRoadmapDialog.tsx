'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface Props {
  roadmapId: string
  title: string
  subject: string | null
  description: string | null
  /** на карточке в списке — только иконка, на странице программы — кнопка с текстом */
  variant?: 'icon' | 'button'
}

// Редактирование программы. PATCH /api/roadmaps/[id] заодно синхронизирует имя
// системной группы («Программа: <название>»), поэтому переименование не
// рассинхронизирует скрытую группу с самой программой.
export function EditRoadmapDialog({
  roadmapId, title, subject, description, variant = 'icon',
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(title)
  const [subj, setSubj] = useState(subject ?? '')
  const [desc, setDesc] = useState(description ?? '')
  const [saving, setSaving] = useState(false)

  // Открываем всегда со свежими пропсами — если программу переименовали в
  // другой вкладке, диалог не покажет устаревшее значение
  function handleOpenChange(next: boolean) {
    if (next) {
      setName(title)
      setSubj(subject ?? '')
      setDesc(description ?? '')
    }
    setOpen(next)
  }

  const trimmed = name.trim()
  const unchanged =
    trimmed === title &&
    subj.trim() === (subject ?? '') &&
    desc.trim() === (description ?? '')

  async function handleSave() {
    // API требует минимум 2 символа (patchSchema в app/api/roadmaps/[id]/route.ts)
    if (trimmed.length < 2) {
      toast.error('Название программы — минимум 2 символа')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/roadmaps/${roadmapId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmed,
          subject: subj.trim() || null,
          description: desc.trim() || null,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(json.error ?? 'Ошибка сохранения')
        return
      }
      toast.success('Программа сохранена')
      setOpen(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {variant === 'icon' ? (
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Редактировать программу">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Pencil className="h-4 w-4 mr-1.5" />
            Редактировать
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Редактирование программы</DialogTitle>
          <DialogDescription>
            Темы, задания и состав учеников не меняются.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="roadmap-title">Название *</Label>
            <Input
              id="roadmap-title"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Подготовка к ОГЭ"
              maxLength={200}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="roadmap-subject">Предмет</Label>
            <Input
              id="roadmap-subject"
              value={subj}
              onChange={(e) => setSubj(e.target.value)}
              placeholder="Необязательно"
              maxLength={100}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="roadmap-description">Описание</Label>
            <Textarea
              id="roadmap-description"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Необязательно"
              rows={3}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving || trimmed.length < 2 || unchanged}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
