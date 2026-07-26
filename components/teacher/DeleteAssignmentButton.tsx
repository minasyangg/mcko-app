'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ConfirmDeleteAction } from '@/components/shared/ConfirmDeleteAction'
import { AlertTriangle, Trash2 } from 'lucide-react'

export function DeleteAssignmentButton({ assignmentId }: { assignmentId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    setLoading(true)
    const res = await fetch(`/api/assignments/${assignmentId}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Назначение удалено')
      router.refresh()
    } else {
      const json = await res.json().catch(() => ({}))
      toast.error(json.error ?? 'Ошибка удаления')
    }
    setLoading(false)
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive px-2">
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <AlertTriangle />
          </AlertDialogMedia>
          <AlertDialogTitle>Удалить назначение?</AlertDialogTitle>
          <AlertDialogDescription>
            Все попытки и результаты учеников по этому назначению будут удалены. Это действие необратимо.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <ConfirmDeleteAction onConfirm={handleDelete} loading={loading} />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
