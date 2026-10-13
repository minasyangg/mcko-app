'use client'

import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import MarkdownContent from '@/components/shared/MarkdownContent'
import { normalizeTags, type TheoryBlock } from '@/lib/theory/types'

export interface TheoryDraft {
  title: string
  subject: string
  grade: string
  tagsText: string
  summary: string
  source_ref: string
  content_md: string
}

export function draftFromBlock(
  block?: Partial<TheoryBlock> | null,
  defaults?: { subject?: string | null; grade?: string | null },
): TheoryDraft {
  return {
    title: block?.title ?? '',
    subject: block?.subject ?? defaults?.subject ?? '',
    grade: block?.grade ?? defaults?.grade ?? '',
    tagsText: (block?.tags ?? []).join(', '),
    summary: block?.summary ?? '',
    source_ref: block?.source_ref ?? '',
    content_md: block?.content_md ?? '',
  }
}

// Тело POST/PATCH (см. lib/theory/schema.ts): пустые каталожные поля → null
export function draftToPayload(d: TheoryDraft) {
  return {
    title: d.title.trim(),
    subject: d.subject.trim() || null,
    grade: d.grade.trim() || null,
    tags: normalizeTags(d.tagsText),
    summary: d.summary.trim() || null,
    source_ref: d.source_ref.trim() || null,
    content_md: d.content_md,
  }
}

interface Props {
  value: TheoryDraft
  onChange: (next: TheoryDraft) => void
  onSubmit: () => void
  onCancel: () => void
  saving?: boolean
  submitLabel?: string
  /** Уже встречавшиеся предметы — подсказки в поле «Предмет» */
  subjectOptions?: string[]
}

// Форма блока теории — общая для библиотеки («Библиотека → Теория») и
// страницы ДЗ. Справа — предпросмотр тем же рендером, что увидит ученик.
export function TheoryForm({ value, onChange, onSubmit, onCancel, saving = false, submitLabel = 'Сохранить', subjectOptions = [] }: Props) {
  const set = (patch: Partial<TheoryDraft>) => onChange({ ...value, ...patch })
  const tags = normalizeTags(value.tagsText)
  const canSubmit = value.title.trim().length > 0 && value.content_md.trim().length > 0 && !saving

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Заголовок *</Label>
        <Input value={value.title} onChange={(e) => set({ title: e.target.value })} className="h-8 text-sm" placeholder="Медиана и среднее арифметическое" />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
        <div className="space-y-1">
          <Label className="text-xs">Предмет</Label>
          <Input
            value={value.subject}
            onChange={(e) => set({ subject: e.target.value })}
            list="theory-subjects"
            className="h-8 text-sm"
            placeholder="Вероятность и статистика"
          />
          <datalist id="theory-subjects">
            {subjectOptions.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Класс</Label>
          <Input value={value.grade} onChange={(e) => set({ grade: e.target.value })} className="h-8 text-sm" placeholder="8" />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Теги — ключевые темы через запятую</Label>
        <Input value={value.tagsText} onChange={(e) => set({ tagsText: e.target.value })} className="h-8 text-sm" placeholder="медиана, размах, выбросы" />
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {tags.map((t) => (
              <span key={t} className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] text-sky-800 dark:bg-sky-950 dark:text-sky-200">{t}</span>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Краткое описание (для карточки в библиотеке)</Label>
          <Textarea value={value.summary} onChange={(e) => set({ summary: e.target.value })} rows={2} className="text-sm resize-none" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Источник</Label>
          <Input value={value.source_ref} onChange={(e) => set({ source_ref: e.target.value })} className="h-8 text-sm" placeholder="Учебник, ч. 1, §7–9, с. 32–43" />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Текст * (Markdown, формулы в $…$, таблицы)</Label>
          <Textarea
            value={value.content_md}
            onChange={(e) => set({ content_md: e.target.value })}
            rows={22}
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1 min-w-0">
          <Label className="text-xs">Как увидит ученик</Label>
          <div className="max-h-[34rem] overflow-y-auto rounded-md border bg-background p-3">
            {value.content_md.trim()
              ? <MarkdownContent content={value.content_md} />
              : <p className="text-sm text-muted-foreground">Здесь появится предпросмотр.</p>}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={onSubmit} disabled={!canSubmit}>
          {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>Отмена</Button>
      </div>
    </div>
  )
}
