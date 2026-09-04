'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { UserCheck, Send, Phone, Mail, ShieldCheck, Clock } from 'lucide-react'

export interface PendingUser {
  id: string
  full_name: string
  email: string | null
  telegram_username: string | null
  phone: string | null
  pd_consent_at: string | null
  created_at: string | null
}

interface TeacherOption { id: string; full_name: string }

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '—'
}

// Заявки с публичной регистрации (/register). Пока заявка на модерации,
// человек в систему не попадает (proxy.ts уводит его на страницу ожидания),
// поэтому решение админа здесь — единственный способ открыть доступ.
export function ModerationTab({
  pending, teachers,
}: {
  pending: PendingUser[]
  teachers: TeacherOption[]
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<PendingUser | null>(null)
  const [role, setRole] = useState<'student' | 'teacher' | 'admin'>('student')
  const [grade, setGrade] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [busy, setBusy] = useState(false)

  function open(u: PendingUser) {
    setSelected(u)
    setRole('student')
    setGrade('')
    setTeacherId('')
  }

  async function decide(action: 'approve' | 'reject') {
    if (!selected) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/moderation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: selected.id,
          action,
          ...(action === 'approve' ? {
            role,
            grade: role === 'student' ? (grade.trim() || null) : null,
            teacher_id: role === 'student' && teacherId ? teacherId : null,
          } : {}),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Ошибка'); return }
      toast.success(action === 'approve'
        ? `${selected.full_name} — доступ открыт`
        : `Заявка ${selected.full_name} отклонена`)
      if (json.warning) toast.warning(json.warning)
      setSelected(null)
      router.refresh()
    } finally { setBusy(false) }
  }

  if (pending.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
        <UserCheck className="h-10 w-10 opacity-40" />
        <p>Заявок на модерации нет.</p>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th className="px-3 py-2 font-medium text-muted-foreground">Заявитель</th>
              <th className="px-3 py-2 font-medium text-muted-foreground">Контакты</th>
              <th className="px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Подана</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {pending.map(u => (
              <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2 font-medium">{u.full_name}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                    {u.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{u.email}</span>}
                    {u.telegram_username && <span className="inline-flex items-center gap-1"><Send className="h-3 w-3" />@{u.telegram_username}</span>}
                    {u.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{u.phone}</span>}
                  </div>
                </td>
                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap tabular-nums text-xs">
                  {fmt(u.created_at)}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="outline" onClick={() => open(u)}>Рассмотреть</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!selected} onOpenChange={(v) => { if (!v && !busy) setSelected(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Заявка: {selected?.full_name}</DialogTitle>
            <DialogDescription>
              Проверьте данные и назначьте роль — после одобрения человек сможет войти.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Что человек указал сам — показываем как есть, без правки:
                админ решает по этим данным, а исправлять их можно потом
                в карточке пользователя */}
            <div className="space-y-1.5 rounded-md border p-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Email</span>
                <span className="truncate font-medium">{selected?.email ?? '—'}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Telegram</span>
                <span className="font-medium">{selected?.telegram_username ? `@${selected.telegram_username}` : '—'}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Телефон</span>
                <span className="font-medium">{selected?.phone ?? '—'}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3 w-3" />Подана
                </span>
                <span className="font-medium tabular-nums">{fmt(selected?.created_at ?? null)}</span>
              </div>
              <div className="flex justify-between gap-3 border-t pt-1.5">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <ShieldCheck className="h-3 w-3" />Согласие 152-ФЗ
                </span>
                {selected?.pd_consent_at
                  ? <Badge variant="secondary" className="h-5">дано {fmt(selected.pd_consent_at)}</Badge>
                  : <span className="text-destructive">нет</span>}
              </div>
            </div>

            <div className="space-y-1">
              <Label>Роль</Label>
              <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">Ученик</SelectItem>
                  <SelectItem value="teacher">Учитель</SelectItem>
                  <SelectItem value="admin">Администратор</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {role === 'student' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="mod-grade">Класс</Label>
                  <Input id="mod-grade" value={grade} onChange={e => setGrade(e.target.value)} placeholder="8" maxLength={16} />
                </div>
                <div className="space-y-1">
                  <Label>Закрепить за учителем</Label>
                  <Select value={teacherId} onValueChange={setTeacherId}>
                    <SelectTrigger><SelectValue placeholder="Не выбран" /></SelectTrigger>
                    <SelectContent>
                      {teachers.map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => decide('reject')}
            >
              Отклонить
            </Button>
            <Button disabled={busy} onClick={() => decide('approve')}>
              {busy ? 'Сохранение...' : 'Одобрить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
