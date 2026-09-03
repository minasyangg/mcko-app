'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeftRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface SwitchTarget {
  id: string
  label: string
  role: 'admin' | 'teacher'
  requires_password: boolean
}

// Быстрое переключение между аккаунтами одного человека (см.
// lib/auth/switch-accounts.ts). Кнопка появляется ТОЛЬКО у тех, кто есть в
// белом списке на сервере: всем остальным GET возвращает пустой массив, и
// компонент не рисует ничего.
//
// Переход вниз по правам (админ→учитель) идёт одним кликом, переход в админа
// открывает окно с полем пароля — как подтверждение операции в банковских
// приложениях. Какой именно случай, решает сервер (requires_password), клиент
// только отрисовывает: проверка прав здесь была бы декоративной.
export function SwitchAccountButton() {
  const [targets, setTargets] = useState<SwitchTarget[]>([])
  const [pending, setPending] = useState<SwitchTarget | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/switch-account')
      .then(r => r.ok ? r.json() : { accounts: [] })
      .then(d => { if (!cancelled) setTargets(d.accounts ?? []) })
      .catch(() => { /* кнопка просто не появится */ })
    return () => { cancelled = true }
  }, [])

  async function doSwitch(target: SwitchTarget, pwd?: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/switch-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: target.id, ...(pwd ? { password: pwd } : {}) }),
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        // Сервер может потребовать пароль даже там, где клиент его не ждал —
        // тогда открываем окно вместо ошибки.
        if (json.requires_password) {
          setPending(target)
          setPassword('')
          if (pwd) toast.error(json.error ?? 'Неверный пароль')
          return
        }
        toast.error(json.error ?? 'Не удалось переключиться')
        return
      }

      toast.success(`Вы вошли как ${json.full_name ?? target.label}`)
      setPending(null)
      setPassword('')
      // Полная перезагрузка, а не router.refresh(): роль сменилась, и весь
      // серверный рендер (навигация, доступы, данные) должен собраться заново.
      window.location.href = json.role === 'student' ? '/student' : '/teacher'
    } finally {
      setBusy(false)
    }
  }

  function handleClick(target: SwitchTarget) {
    if (target.requires_password) {
      setPending(target)
      setPassword('')
      return
    }
    doSwitch(target)
  }

  if (targets.length === 0) return null

  return (
    <>
      {targets.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => handleClick(t)}
          disabled={busy}
          title={`Переключиться на аккаунт: ${t.label}`}
          className="flex w-full items-center gap-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
        >
          {busy && !pending
            ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            : <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{t.label}</span>
        </button>
      ))}

      <Dialog
        open={!!pending}
        onOpenChange={(v) => { if (!v && !busy) { setPending(null); setPassword('') } }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Вход в аккаунт «{pending?.label}»</DialogTitle>
            <DialogDescription>
              Этот аккаунт даёт полные права администратора, поэтому вход
              подтверждается паролем.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (pending && password) doSwitch(pending, password)
            }}
            className="space-y-4"
          >
            <div className="space-y-1">
              <Label htmlFor="switch-password">Пароль</Label>
              <PasswordInput
                id="switch-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="current-password"
                disabled={busy}
              />
            </div>
            <DialogFooter>
              <Button
                type="button" variant="outline" disabled={busy}
                onClick={() => { setPending(null); setPassword('') }}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={busy || !password}>
                {busy ? 'Вход...' : 'Войти'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
