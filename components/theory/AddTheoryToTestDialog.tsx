'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/shared/SearchableSelect'

interface Props {
  open: boolean
  onClose: () => void
  block: { id: string; title: string } | null
  /** already — блок уже был подключён к этому заданию, ничего не изменилось */
  onAdded?: (already: boolean) => void
}

interface TestOption { id: string; title: string; kind: string; status: string }

// «Добавить теорию в ДЗ» из библиотеки. В отличие от задач, теория не
// копируется в версию теста, а подключается к самому тесту — поэтому годится
// любое ДЗ, в том числе уже опубликованное (ученики увидят теорию сразу).
// Список — тесты, видимые учителю по RLS; права (свой тест / админ) повторно
// проверяет API.
export function AddTheoryToTestDialog({ open, onClose, block, onAdded }: Props) {
  const [tests, setTests] = useState<TestOption[] | null>(null)
  const [testId, setTestId] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!open) return
    // список — с сервера (GET /api/theory/targets), как и каталог теории:
    // прямое чтение из браузера у учителя возвращало пустоту
    fetch('/api/theory/targets', { cache: 'no-store' })
      .then((res) => res.json().catch(() => ({})))
      .then((data: { tests?: TestOption[] }) => {
        const list = data.tests ?? []
        setTests(list)
        // Предвыбор ДЗ, со страницы которого учитель пришёл подбирать материал
        // (тот же ключ, что у задач книг/библиотеки — см. AddTargetBanner);
        // иначе выбор с прошлого открытия сбрасывается
        let preselect = ''
        try {
          const raw = sessionStorage.getItem('mcko:add-to-test')
          if (raw) {
            const { testId: tid, ts } = JSON.parse(raw) as { testId?: string; ts?: number }
            if (tid && Date.now() - (ts ?? 0) < 2 * 60 * 60 * 1000 && list.some((t) => t.id === tid)) preselect = tid
          }
        } catch { /* sessionStorage недоступен — без предвыбора */ }
        setTestId(preselect)
      })
  }, [open])

  async function handleAdd() {
    if (!block || !testId) return
    setAdding(true)
    try {
      const res = await fetch(`/api/theory/${block.id}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_id: testId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'Не удалось подключить теорию')
        return
      }
      const title = tests?.find((t) => t.id === testId)?.title ?? 'задание'
      toast.success(data.already
        ? `Теория «${block.title}» уже подключена к «${title}»`
        : `Теория «${block.title}» подключена к «${title}»`)
      onAdded?.(!!data.already)
      onClose()
    } finally {
      setAdding(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Добавить теорию в задание</DialogTitle>
          <DialogDescription>
            «{block?.title}» появится у учеников над заданиями выбранного теста или ДЗ.
            Блок не копируется: правка в библиотеке будет видна во всех заданиях.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Тест или домашнее задание</Label>
            <SearchableSelect
              options={(tests ?? []).map((t) => ({
                value: t.id,
                label: t.title,
                badge: t.kind === 'homework' ? 'ДЗ' : null,
                hint: t.status === 'published' ? 'опубликовано' : 'черновик',
              }))}
              value={testId}
              onChange={setTestId}
              placeholder="Выберите тест или ДЗ..."
              recentLabel="Недавно созданные"
              emptyText="Ничего не найдено"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={adding}>Отмена</Button>
            <Button onClick={handleAdd} disabled={!testId || adding}>{adding ? 'Подключение...' : 'Добавить'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
