'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Trash2, UserX } from 'lucide-react'
import { toast } from 'sonner'

interface Student {
  id: string
  full_name: string
  grade: string | null
  is_active: boolean
  created_at: string | null
  deleted_at: string | null
}

interface StudentsTableClientProps {
  students: Student[]
  onStudentDeleted: (studentId: string) => void
}

export function StudentsTableClient({ students: initialStudents, onStudentDeleted }: StudentsTableClientProps) {
  const [students, setStudents] = useState(initialStudents)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDeleteStudent = async (studentIdToDelete: string) => {
    setIsDeleting(true)
    try {
      const response = await fetch(`/api/admin/students/${studentIdToDelete}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Ошибка удаления ученика')
      }

      await response.json()

      // Update local state
      setStudents(prev => prev.filter(s => s.id !== studentIdToDelete))
      setDeleteConfirmId(null)

      toast.success('Ученик удален успешно', {
        description: 'Результаты тестов сохранены для аналитики',
      })

      onStudentDeleted(studentIdToDelete)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
      toast.error('Ошибка удаления', {
        description: message,
      })
      console.error('Delete student error:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">ФИО</th>
              <th className="text-left px-4 py-3 font-medium">Класс</th>
              <th className="text-left px-4 py-3 font-medium">Статус</th>
              <th className="text-left px-4 py-3 font-medium">Дата регистрации</th>
              <th className="text-right px-4 py-3 font-medium">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {students.map((s) => {
              const isDeleted = s.deleted_at != null

              return (
                <tr
                  key={s.id}
                  className={`transition-colors ${
                    isDeleted
                      ? 'bg-muted/20 hover:bg-muted/30 opacity-60'
                      : 'hover:bg-muted/30'
                  }`}
                >
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{s.full_name}</span>
                      {isDeleted && (
                        <UserX className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{s.grade ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge variant={isDeleted ? 'outline' : s.is_active ? 'default' : 'secondary'}>
                      {isDeleted ? 'Выбыл' : s.is_active ? 'Активен' : 'Неактивен'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.created_at
                      ? new Date(s.created_at).toLocaleDateString('ru-RU')
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!isDeleted && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteConfirmId(s.id)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Удалить ученика</span>
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Delete confirmation dialog */}
      {deleteConfirmId && (
        <AlertDialog open onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить ученика?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>
                  Это действие удалит ученика{' '}
                  <strong>{students.find(s => s.id === deleteConfirmId)?.full_name}</strong>.
                </p>
                <ul className="list-disc list-inside text-sm space-y-1 mt-2">
                  <li>Все индивидуальные назначения будут удалены</li>
                  <li>Ученик будет удален из всех групп</li>
                  <li>Попытки тестирования будут удалены</li>
                  <li>
                    <strong>Финальные результаты будут сохранены</strong> для
                    аналитики
                  </li>
                </ul>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogAction
              onClick={() => handleDeleteStudent(deleteConfirmId)}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeleting ? 'Удаление...' : 'Удалить'}
            </AlertDialogAction>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  )
}
