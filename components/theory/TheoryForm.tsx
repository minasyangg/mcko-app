'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Bold, ChartColumn, ChartSpline, ChartLine, CircleHelp, Divide, Heading, ImagePlus, Info, List, ListOrdered,
  Loader2, Sigma, Table,
} from 'lucide-react'
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

const GRAPH_TEMPLATE = '\n```graph\ny = x^2\ny = (x - 2)^2 - 3\nx: -4..6\nx = 2\nточка: (2; -3) A\n```\n'
// физический график: подписи осей, независимый масштаб, ломаная по точкам
const PHYS_GRAPH_TEMPLATE = '\n```graph\nоси: t, с; v, м/с\nv = 2 + 1.5t\nломаная: (0; 8) (4; 8) (6; 0) второе тело\nx: 0..8\n```\n'
const CHART_TEMPLATE = '\n```chart\nтип: столбики\nзаголовок: Продажа шоколада\nПн: 8\nВт: 5\nСр: 4\nЧт: 2\nПт: 3\n```\n'
const TABLE_TEMPLATE = '\n| Столбец 1 | Столбец 2 |\n|---|---|\n| … | … |\n| … | … |\n'

// Форма блока теории — общая для библиотеки («Библиотека → Теория») и
// страницы ДЗ. Текст — на всю ширину с панелью вставки (формулы, таблица,
// картинка, график, диаграмма), предпросмотр — под ним тем же рендером,
// что увидит ученик.
export function TheoryForm({ value, onChange, onSubmit, onCancel, saving = false, submitLabel = 'Сохранить', subjectOptions = [] }: Props) {
  const set = (patch: Partial<TheoryDraft>) => onChange({ ...value, ...patch })
  const tags = normalizeTags(value.tagsText)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const canSubmit = value.title.trim().length > 0 && value.content_md.trim().length > 0 && !saving && !uploading

  // Вставка в позицию курсора: before + (выделенный текст или заготовка) + after
  function insert(before: string, after = '', placeholder = '') {
    const el = textRef.current
    const text = value.content_md
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const selected = text.slice(start, end) || placeholder
    set({ content_md: text.slice(0, start) + before + selected + after + text.slice(end) })
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const s = start + before.length
      el.setSelectionRange(s, s + selected.length)
    })
  }

  // Префикс в начало текущей строки («### », «- », «1. », «> »)
  function linePrefix(prefix: string) {
    const el = textRef.current
    const text = value.content_md
    const pos = el?.selectionStart ?? text.length
    const lineStart = text.lastIndexOf('\n', pos - 1) + 1
    set({ content_md: text.slice(0, lineStart) + prefix + text.slice(lineStart) })
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos + prefix.length, pos + prefix.length) })
  }

  async function uploadImage(file: File) {
    setUploading(true)
    try {
      const prepared = await downscaleImage(file)
      const body = new FormData()
      body.append('file', prepared)
      const res = await fetch('/api/theory/media', { method: 'POST', body })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'Не удалось загрузить картинку')
        return
      }
      insert('\n![', `](${data.url})\n`, 'описание картинки')
      toast.success('Картинка загружена')
    } finally {
      setUploading(false)
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
    if (!file) return
    e.preventDefault()
    void uploadImage(file)
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Заголовок *</Label>
        <Input value={value.title} onChange={(e) => set({ title: e.target.value })} className="h-8 text-sm" placeholder="Медиана и среднее арифметическое" />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_6rem_2fr]">
        <div className="space-y-1">
          <Label className="text-xs">Предмет</Label>
          <Input value={value.subject} onChange={(e) => set({ subject: e.target.value })} list="theory-subjects" className="h-8 text-sm" placeholder="Алгебра" />
          <datalist id="theory-subjects">
            {subjectOptions.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Класс</Label>
          <Input value={value.grade} onChange={(e) => set({ grade: e.target.value })} className="h-8 text-sm" placeholder="8" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Теги — ключевые темы через запятую</Label>
          <Input value={value.tagsText} onChange={(e) => set({ tagsText: e.target.value })} className="h-8 text-sm" placeholder="медиана, размах, выбросы" />
        </div>
      </div>
      {tags.length > 0 && (
        <div className="-mt-1 flex flex-wrap gap-1">
          {tags.map((t) => (
            <span key={t} className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] text-sky-800 dark:bg-sky-950 dark:text-sky-200">{t}</span>
          ))}
        </div>
      )}

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

      {/* Текст — на всю ширину, с панелью вставки */}
      <div className="space-y-1">
        <Label className="text-xs">Текст *</Label>
        <div className="rounded-md border border-input focus-within:border-ring">
          <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-1 py-1">
            <ToolButton title="Заголовок раздела" icon={<Heading className="h-4 w-4" />} onClick={() => linePrefix('### ')} disabled={uploading} />
            <ToolButton title="Жирный" icon={<Bold className="h-4 w-4" />} onClick={() => insert('**', '**', 'важное')} disabled={uploading} />
            <ToolButton title="Список" icon={<List className="h-4 w-4" />} onClick={() => linePrefix('- ')} disabled={uploading} />
            <ToolButton title="Нумерованный список" icon={<ListOrdered className="h-4 w-4" />} onClick={() => linePrefix('1. ')} disabled={uploading} />
            <ToolButton title="Выделить «Важно»" icon={<Info className="h-4 w-4" />} onClick={() => linePrefix('> **Важно.** ')} disabled={uploading} />
            <span className="mx-1 h-5 w-px bg-border" />
            <ToolButton title="Формула в строке" label="Формула" icon={<Sigma className="h-4 w-4" />} onClick={() => insert('$', '$', 'x^2')} disabled={uploading} />
            <ToolButton title="Формула отдельной строкой" label="Строкой" icon={<Sigma className="h-4 w-4" />} onClick={() => insert('\n$$\n', '\n$$\n', 'y = ax^2 + bx + c')} disabled={uploading} />
            <ToolButton title="Дробь" label="Дробь" icon={<Divide className="h-4 w-4" />} onClick={() => insert('$\\frac{', '}{b}$', 'a')} disabled={uploading} />
            <ToolButton title="Таблица" label="Таблица" icon={<Table className="h-4 w-4" />} onClick={() => insert(TABLE_TEMPLATE)} disabled={uploading} />
            <span className="mx-1 h-5 w-px bg-border" />
            <ToolButton
              title="Картинка (или вставьте из буфера — Ctrl+V)"
              label="Картинка"
              icon={uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            />
            <ToolButton title="График функции" label="График" icon={<ChartSpline className="h-4 w-4" />} onClick={() => insert(GRAPH_TEMPLATE)} disabled={uploading} />
            <ToolButton title="Физический график: подписи осей (t, с; v, м/с), ломаная по точкам" label="Физ. график" icon={<ChartLine className="h-4 w-4" />} onClick={() => insert(PHYS_GRAPH_TEMPLATE)} disabled={uploading} />
            <ToolButton title="Диаграмма (столбики, круговая, линия)" label="Диаграмма" icon={<ChartColumn className="h-4 w-4" />} onClick={() => insert(CHART_TEMPLATE)} disabled={uploading} />
            <span className="flex-1" />
            <ToolButton title="Как записывать формулы, графики и диаграммы" label="Подсказка" icon={<CircleHelp className="h-4 w-4" />} onClick={() => setShowHelp((v) => !v)} />

          </div>
          {showHelp && <FormatHelp />}
          {/* обычный textarea, а не ui/Textarea: у того field-sizing-content
              (высота по содержимому), и пустое поле было в две строки */}
          <textarea
            ref={textRef}
            value={value.content_md}
            onChange={(e) => set({ content_md: e.target.value })}
            onPaste={handlePaste}
            className="block h-104 min-h-40 w-full resize-y bg-transparent px-3 py-2 font-mono text-xs leading-relaxed outline-none"
            placeholder={'### Заголовок раздела\nТекст, формулы в $…$, таблицы, картинки (Ctrl+V), графики — кнопками выше.'}
          />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void uploadImage(f)
          }}
        />
      </div>

      {/* Предпросмотр — под текстом, на всю ширину */}
      <div className="space-y-1">
        <Label className="text-xs">Как увидит ученик</Label>
        <div className="rounded-md border bg-background p-4">
          {value.content_md.trim()
            ? <MarkdownContent content={value.content_md} />
            : <p className="text-sm text-muted-foreground">Здесь появится предпросмотр.</p>}
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

function ToolButton({ title, icon, onClick, label, disabled }: {
  title: string; icon: React.ReactNode; onClick: () => void; label?: string; disabled?: boolean
}) {
  return (
    <Button type="button" size="sm" variant="ghost" className="h-8 px-2" title={title} onClick={onClick} disabled={disabled}>
      {icon}
      {label && <span className="ml-1 hidden text-xs lg:inline">{label}</span>}
    </Button>
  )
}

function FormatHelp() {
  return (
    <div className="grid gap-3 border-b bg-sky-50/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground sm:grid-cols-3 dark:bg-sky-950/20">
      <div>
        <p className="font-medium text-foreground">Формулы</p>
        <p><code>$x^2 + 1$</code> — в строке, <code>$$…$$</code> — отдельной строкой.</p>
        <p><code>{'\\frac{a}{b}'}</code> — дробь, <code>{'\\sqrt{x}'}</code> — корень, <code>{'x_1'}</code> — индекс.</p>
      </div>
      <div>
        <p className="font-medium text-foreground">График (блок <code>```graph</code>)</p>
        <p><code>y = 2(x - 1)^2 + 3</code> — функция, можно несколько строк.</p>
        <p><code>x: -4..6</code> — отрезок по x; <code>x = 2</code> — пунктирная прямая; <code>точка: (1; 3) A</code>.</p>
        <p>Физика: <code>оси: t, с; v, м/с</code> — подписи осей, формулы в их буквах <code>v = 2 + 3t</code>; <code>ломаная: (0; 20) (5; 80) (15; 80) нагрев</code> — график по точкам.</p>
      </div>
      <div>
        <p className="font-medium text-foreground">Диаграмма (блок <code>```chart</code>)</p>
        <p><code>тип: столбики</code> | <code>круговая</code> | <code>линия</code>, <code>заголовок: …</code></p>
        <p>Данные — строки «подпись: число»: <code>Пн: 8</code>.</p>
      </div>
    </div>
  )
}

// Крупные фото уменьшаем в браузере до 1600 px по большей стороне: запрос к
// функции Vercel ограничен 4,5 МБ, а для теории хватает и меньшего размера.
// GIF не трогаем — потерялась бы анимация.
async function downscaleImage(file: File): Promise<File> {
  if (file.type === 'image/gif' || file.size < 1.5 * 1024 * 1024) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.85))
    // старый Safari не умеет WebP и отдаёт PNG — тип берём у самого blob:
    // сервер сверяет его с сигнатурой файла
    if (!blob) return file
    const ext = blob.type === 'image/webp' ? 'webp' : 'png'
    return new File([blob], `${file.name.replace(/\.\w+$/, '')}.${ext}`, { type: blob.type || 'image/png' })
  } catch {
    return file
  }
}
