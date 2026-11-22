'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Minus, Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { useAppSettings } from '@/components/shared/AppSettingsProvider'

function attemptsWord(n: number) {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'попытка'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'попытки'
  return 'попыток'
}

// винительный падеж для «Добавить 1 попытку»
function attemptsAcc(n: number) {
  return n % 10 === 1 && n % 100 !== 11 ? 'попытку' : attemptsWord(n)
}

interface Props {
  assignmentId: string
  /** Текущий лимит попыток назначения */
  maxAttempts: number
  /** Название задания — для заголовка диалога */
  title?: string
  /** Кнопка-триггер (например, «2 поп.»); без неё — стандартная кнопка */
  children?: React.ReactNode
  /** Вызывается после успешного добавления — для обновления локальных данных */
  onAdded?: (maxAttempts: number) => void
}

// Дополнительные попытки всем адресатам назначения (программа, группа, личное):
// ученики, у которых попытки кончились, снова могут решать, итог — лучший балл
// по каждому заданию (POST /api/assignments/[id]/attempts).
export function AddAttemptsDialog({ assignmentId, maxAttempts, title, children, onAdded }: Props) {
  const router = useRouter()
  // сколько можно добавить за раз — настройка системы (сервер проверяет её же)
  const { attempts_add_max: maxAdd } = useAppSettings()
  const [open, setOpen] = useState(false)
  const [add, setAdd] = useState(1)
  const [loading, setLoading] = useState(false)

  async function submit() {
    setLoading(true)
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ add }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Не удалось добавить попытки'); return }

      const parts = [`Теперь ${json.max_attempts} ${attemptsWord(json.max_attempts)} на ученика`]
      if (json.reopened_students) parts.push(`снова открыто для ${json.reopened_students} уч.`)
      toast.success(parts.join(', '))
      // добавленные попытки бесполезны, пока назначение закрыто — говорим об этом
      // сразу, а не оставляем учителя гадать, почему ученики не решают
      if (json.closed_for_all) toast.warning('Назначение завершено учителем — откройте его, чтобы ученики могли решать')
      // срок прошёл — попытки всё равно открыты; дедлайн не переписывается, а
      // работа в добавленную попытку отмечается отдельно от опоздания (112)
      if (json.deadline_passed) toast.info('Срок сдачи прошёл, но попытки открыты. Дата срока не меняется, работы отметятся как «решено в доп. попытку»')

      onAdded?.(json.max_attempts)
      setOpen(false)
      setAdd(1)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!loading) { setOpen(v); if (!v) setAdd(1) } }}>
      <DialogTrigger asChild>
        {children ?? (
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" title="Добавить попытки">
            <Plus className="h-3.5 w-3.5" />
            <span className="ml-1">Попытки</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Добавить попытки</DialogTitle>
          <DialogDescription>
            {title ? <>«{title}». </> : null}
            Сейчас {maxAttempts} {attemptsWord(maxAttempts)} на ученика.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center gap-3 py-2">
          <Button type="button" variant="outline" size="icon" aria-label="Меньше"
            disabled={add <= 1 || loading} onClick={() => setAdd(a => Math.max(1, a - 1))}>
            <Minus className="h-4 w-4" />
          </Button>
          <div className="min-w-24 text-center">
            <div className="text-2xl font-semibold tabular-nums">+{add}</div>
            <div className="text-xs text-muted-foreground">станет {maxAttempts + add}</div>
          </div>
          <Button type="button" variant="outline" size="icon" aria-label="Больше"
            disabled={add >= maxAdd || loading} onClick={() => setAdd(a => Math.min(maxAdd, a + 1))}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Попытки добавляются всем ученикам назначения. Те, у кого попытки закончились,
          смогут решать снова. В итог идёт лучший балл по каждому заданию: новая попытка
          может только улучшить результат, а задания, решённые на полный балл, остаются засчитанными.
          Срок сдачи не мешает: попытки открываются и после него, а в результатах такая работа
          отмечается как «решено в доп. попытку».
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Отмена</Button>
          <Button onClick={submit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Добавить {add} {attemptsAcc(add)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
