'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ConfirmDeleteAction } from '@/components/shared/ConfirmDeleteAction'

interface Props {
  groupId: string
  groupName: string
  redirectAfterDelete?: boolean
}

export function DeleteGroupButton({ groupId, groupName, redirectAfterDelete = false }: Props) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/groups/${groupId}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(json.error ?? 'Ошибка удаления группы')
        return
      }
      toast.success(`Группа «${groupName}» удалена`)
      if (redirectAfterDelete) {
        router.push('/teacher/groups')
      } else {
        router.refresh()
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost" size="sm"
          className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
          title="Удалить группу"
          disabled={deleting}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <AlertTriangle />
          </AlertDialogMedia>
          <AlertDialogTitle>Удалить группу «{groupName}»?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">Будут удалены:</span>
            <ul className="list-disc list-inside text-sm space-y-0.5">
              <li>Членство всех учеников в этой группе</li>
              <li>Все назначения тестов на эту группу</li>
              <li>Все попытки и ответы по этим назначениям</li>
            </ul>
            <span className="block pt-1">
              <strong>Сами ученики не удаляются.</strong>
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <ConfirmDeleteAction onConfirm={handleDelete} loading={deleting} label="Удалить группу" />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
