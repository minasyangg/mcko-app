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
  groupId: string
  groupName: string
  groupDescription: string | null
  // на карточке в списке — только иконка, на странице группы — кнопка с текстом
  variant?: 'icon' | 'button'
}

export function EditGroupDialog({ groupId, groupName, groupDescription, variant = 'icon' }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(groupName)
  const [description, setDescription] = useState(groupDescription ?? '')
  const [saving, setSaving] = useState(false)

  // Диалог открывается с текущими значениями: если группу переименовали в
  // другой вкладке, при следующем открытии подтянутся свежие пропсы
  function handleOpenChange(next: boolean) {
    if (next) {
      setName(groupName)
      setDescription(groupDescription ?? '')
    }
    setOpen(next)
  }

  const trimmed = name.trim()
  const unchanged = trimmed === groupName && description.trim() === (groupDescription ?? '')

  async function handleSave() {
    if (!trimmed) {
      toast.error('Введите название группы')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, description: description.trim() || null }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(json.error ?? 'Ошибка сохранения')
        return
      }
      toast.success('Группа сохранена')
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
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Переименовать группу">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Pencil className="h-4 w-4 mr-1" />
            Редактировать
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Редактирование группы</DialogTitle>
          <DialogDescription>
            Название и описание видны учителям в списке групп. Состав участников не меняется.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="group-name">Название *</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: 10А"
              maxLength={100}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="group-description">Описание</Label>
            <Textarea
              id="group-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
          <Button onClick={handleSave} disabled={saving || !trimmed || unchanged}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
