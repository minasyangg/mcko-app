'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface EditableTest {
  testId: string
  title: string
  versionId: string
  kind: string
}

export interface AddToTestDialogProps {
  open: boolean
  onClose: () => void
  // endpoint, в который POST-ится { test_version_id, max_score }
  addUrl: string | null
  // подпись задания в заголовке диалога, например "№ 735"
  problemLabel: string
}

// Универсальный диалог «добавить задание в тест/ДЗ»: работает и для книг,
// и для библиотеки — отличается только addUrl.
export function AddToTestDialog({ open, onClose, addUrl, problemLabel }: AddToTestDialogProps) {
  const [tests, setTests] = useState<EditableTest[] | null>(null)
  const [versionId, setVersionId] = useState('')
  const [maxScore, setMaxScore] = useState('1')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!open) return
    setVersionId('')
    setMaxScore('1')
    const supabase = createClient()
    supabase
      .from('tests')
      // !test_id — между tests и test_versions две FK-связи (вторая через
      // current_published_version_id), без уточнения PostgREST вернёт 400
      .select('id, title, kind, test_versions!test_id(id, status, version_number)')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const editable: EditableTest[] = []
        for (const t of data ?? []) {
          const raw = t.test_versions ?? []
          const list = Array.isArray(raw) ? raw : [raw]
          const versions = list
            .filter(v => v.status === 'draft' || v.status === 'in_review')
            .sort((a, b) => (b.version_number ?? 0) - (a.version_number ?? 0))
          if (versions.length > 0) {
            editable.push({
              testId: t.id,
              title: t.title,
              versionId: versions[0].id,
              kind: (t as { kind?: string }).kind ?? 'test',
            })
          }
        }
        setTests(editable)

        // Предвыбор цели, если пришли из редактора теста/ДЗ (свежая, до 2 часов).
        // Выбор можно сменить вручную.
        try {
          const raw = sessionStorage.getItem('mcko:add-to-test')
          if (raw) {
            const { versionId: vid, ts } = JSON.parse(raw) as { versionId?: string; ts?: number }
            if (vid && Date.now() - (ts ?? 0) < 2 * 60 * 60 * 1000 && editable.some(t => t.versionId === vid)) {
              setVersionId(vid)
            }
          }
        } catch { /* sessionStorage недоступен — просто без предвыбора */ }
      })
  }, [open])

  async function handleAdd() {
    if (!addUrl || !versionId) return
    setAdding(true)
    try {
      const res = await fetch(addUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test_version_id: versionId,
          max_score: Number(maxScore) || 1,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'Ошибка добавления в тест')
        return
      }
      const test = tests?.find(t => t.versionId === versionId)
      toast.success(`Задание ${problemLabel} добавлено в «${test?.title ?? 'тест'}» под № ${data.task_number}`)
      onClose()
    } catch {
      toast.error('Ошибка сети')
    } finally {
      setAdding(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Добавить задание {problemLabel}</DialogTitle>
          <DialogDescription>
            Задание будет скопировано в выбранный тест или домашнее задание
            (только черновики и версии на проверке).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Тест или домашнее задание</Label>
            <Select value={versionId || '_none'} onValueChange={(v) => setVersionId(v === '_none' ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите тест..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— Выберите —</SelectItem>
                {(tests ?? []).map(t => (
                  <SelectItem key={t.versionId} value={t.versionId}>
                    {t.title}{t.kind === 'homework' ? ' · ДЗ' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tests !== null && tests.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Нет тестов или ДЗ, доступных для редактирования. Создайте их в разделе «Задания».
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Макс. балл</Label>
            <Input
              type="number"
              min={1}
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
              className="w-24"
            />
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={onClose} disabled={adding}>Отмена</Button>
            <Button onClick={handleAdd} disabled={!versionId || adding}>
              {adding ? 'Добавление...' : 'Добавить'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
