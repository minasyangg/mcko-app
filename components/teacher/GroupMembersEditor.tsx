'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Trash2, UserPlus } from 'lucide-react'

interface Member {
  user_id: string
  added_at: string | null
  profiles: {
    full_name: string
    grade: string | null
  } | null
}

interface AvailableStudent {
  id: string
  full_name: string
  grade: string | null
}

interface Props {
  groupId: string
  initialMembers: Member[]
  availableStudents: AvailableStudent[]
}

export function GroupMembersEditor({ groupId, initialMembers, availableStudents }: Props) {
  const router = useRouter()
  const [members, setMembers] = useState<Member[]>(initialMembers)
  const [students, setStudents] = useState<AvailableStudent[]>(availableStudents)
  const [selectedStudentId, setSelectedStudentId] = useState<string>('')
  const [isPending, startTransition] = useTransition()
  const [addingLoading, setAddingLoading] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const supabase = createClient()

  async function handleAdd() {
    if (!selectedStudentId) return
    setAddingLoading(true)
    try {
      const res = await fetch(`/api/groups/${groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: selectedStudentId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Ошибка добавления')
      }

      const student = students.find((s) => s.id === selectedStudentId)
      if (student) {
        setMembers((prev) => [
          ...prev,
          {
            user_id: student.id,
            added_at: new Date().toISOString(),
            profiles: { full_name: student.full_name, grade: student.grade },
          },
        ])
        setStudents((prev) => prev.filter((s) => s.id !== selectedStudentId))
      }
      setSelectedStudentId('')
      toast.success('Ученик добавлен в группу')
      startTransition(() => router.refresh())
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Ошибка добавления')
    } finally {
      setAddingLoading(false)
    }
  }

  async function handleRemove(userId: string) {
    setRemovingId(userId)
    try {
      const res = await fetch(`/api/groups/${groupId}/members?user_id=${userId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Ошибка удаления')
      }

      const removedMember = members.find((m) => m.user_id === userId)
      setMembers((prev) => prev.filter((m) => m.user_id !== userId))
      if (removedMember?.profiles) {
        setStudents((prev) => [
          ...prev,
          {
            id: userId,
            full_name: removedMember.profiles!.full_name,
            grade: removedMember.profiles!.grade,
          },
        ])
      }
      toast.success('Ученик удалён из группы')
      startTransition(() => router.refresh())
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Ошибка удаления')
    } finally {
      setRemovingId(null)
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('ru-RU')
  }

  return (
    <div className="space-y-6">
      {/* Members list */}
      <div>
        <h3 className="text-sm font-medium mb-3">
          Участники ({members.length})
        </h3>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center border rounded-md">
            В группе нет участников
          </p>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Ученик</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Класс</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Добавлен</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.user_id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {(member.profiles?.full_name ?? '?').charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium">{member.profiles?.full_name ?? '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {member.profiles?.grade ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(member.added_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={removingId === member.user_id}
                        onClick={() => handleRemove(member.user_id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add member form */}
      <div>
        <h3 className="text-sm font-medium mb-3">Добавить участника</h3>
        {students.length === 0 ? (
          <p className="text-sm text-muted-foreground">Все ученики организации уже в группе</p>
        ) : (
          <div className="flex items-center gap-2">
            <Select
              value={selectedStudentId}
              onValueChange={setSelectedStudentId}
            >
              <SelectTrigger className="w-72">
                <SelectValue placeholder="Выберите ученика..." />
              </SelectTrigger>
              <SelectContent>
                {students.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.full_name}
                    {s.grade ? ` (${s.grade} кл.)` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={handleAdd}
              disabled={!selectedStudentId || addingLoading}
              size="sm"
            >
              <UserPlus className="h-4 w-4 mr-1.5" />
              Добавить
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
