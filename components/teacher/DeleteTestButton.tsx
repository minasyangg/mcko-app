'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ConfirmDeleteAction } from '@/components/shared/ConfirmDeleteAction'
import { AlertTriangle, Trash2 } from 'lucide-react'

interface DeleteTestButtonProps {
  testId: string
  testTitle: string
}

export function DeleteTestButton({ testId, testTitle }: DeleteTestButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    setLoading(true)
    try {
      const res = await fetch(`/api/tests/${testId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error ?? 'Ошибка при удалении теста')
        return
      }
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10">
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <AlertTriangle />
          </AlertDialogMedia>
          <AlertDialogTitle>Удалить тест?</AlertDialogTitle>
          <AlertDialogDescription>
            Тест <span className="font-semibold">&quot;{testTitle}&quot;</span> и все его данные (версии, задачи,
            назначения, попытки) будут удалены без возможности восстановления.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Отмена</AlertDialogCancel>
          <ConfirmDeleteAction onConfirm={handleDelete} loading={loading} />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
