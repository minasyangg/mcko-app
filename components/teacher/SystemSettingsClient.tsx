'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  SETTING_DEFS, SETTING_GROUPS, dispatchAllDay, lastDispatchTime,
  validateSetting, validateSettingsCombo, type AppSettings, type SettingDef, type SettingKey,
} from '@/lib/settings/registry'

type Draft = Record<SettingKey, string>

const toDraft = (s: AppSettings) =>
  Object.fromEntries(SETTING_DEFS.map(d => [d.key, String(s[d.key])])) as Draft

// Форма настроек системы (114). Отправляет только изменённые ключи; «по
// умолчанию» у изменённого в БД значения удаляет строку, а не записывает
// число — тогда новое значение по умолчанию из кода подхватится само.
export function SystemSettingsClient({ initial, changedAt }: {
  initial: AppSettings
  /** Ключи, заданные в БД (не по умолчанию), → когда изменены */
  changedAt: Record<string, string>
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial))
  const [resets, setResets] = useState<Set<SettingKey>>(new Set())
  const [saving, setSaving] = useState(false)

  const parsed = Object.fromEntries(
    SETTING_DEFS.map(d => [d.key, Number(draft[d.key])])
  ) as AppSettings
  const fieldErrors = Object.fromEntries(
    SETTING_DEFS.map(d => [d.key, draft[d.key].trim() === '' ? 'Укажите значение' : validateSetting(d.key, parsed[d.key])])
  ) as Record<SettingKey, string | null>
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean)
  const comboError = hasFieldErrors ? null : validateSettingsCombo(parsed)

  const changes: Partial<Record<SettingKey, number | null>> = {}
  for (const d of SETTING_DEFS) {
    if (fieldErrors[d.key]) continue
    if (resets.has(d.key) && parsed[d.key] === d.default) changes[d.key] = null
    else if (parsed[d.key] !== initial[d.key]) changes[d.key] = parsed[d.key]
  }
  const dirty = Object.keys(changes).length > 0

  function setValue(key: SettingKey, value: string) {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  function resetToDefault(d: SettingDef) {
    setValue(d.key, String(d.default))
    if (changedAt[d.key]) setResets(prev => new Set(prev).add(d.key))
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: changes }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json.error ?? 'Не удалось сохранить'); return }
      toast.success(json.schedule ? 'Сохранено, расписание рассылки обновлено' : 'Сохранено')
      setResets(new Set())
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {SETTING_GROUPS.map(g => (
        <Card key={g.key}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{g.title}</CardTitle>
            {g.key === 'notifications' && !hasFieldErrors && !comboError && (
              <p className="text-xs text-muted-foreground">
                Сейчас: каждые {parsed.notify_interval_min} мин
                {dispatchAllDay(parsed)
                  ? ', круглосуточно'
                  : ` с ${parsed.notify_from_hour}:00 до ${lastDispatchTime(parsed)} по Москве`}
              </p>
            )}
          </CardHeader>
          <CardContent className="divide-y">
            {SETTING_DEFS.filter(d => d.group === g.key).map(d => (
              <SettingRow
                key={d.key}
                def={d}
                value={draft[d.key]}
                error={fieldErrors[d.key]}
                changedAt={resets.has(d.key) ? undefined : changedAt[d.key]}
                onChange={v => setValue(d.key, v)}
                onReset={() => resetToDefault(d)}
              />
            ))}
          </CardContent>
        </Card>
      ))}

      <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-background/95 backdrop-blur border-t flex items-center gap-3 flex-wrap">
        <Button onClick={save} disabled={!dirty || hasFieldErrors || !!comboError || saving}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Сохранить
        </Button>
        {dirty && !saving && (
          <Button variant="ghost" onClick={() => { setDraft(toDraft(initial)); setResets(new Set()) }}>
            Отменить изменения
          </Button>
        )}
        {comboError && <p className="text-sm text-destructive">{comboError}</p>}
      </div>
    </div>
  )
}

function SettingRow({ def, value, error, changedAt, onChange, onReset }: {
  def: SettingDef
  value: string
  error: string | null
  changedAt?: string
  onChange: (v: string) => void
  onReset: () => void
}) {
  const isDefault = Number(value) === def.default
  const inputId = `setting-${def.key}`

  return (
    <div className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
      <div className="flex-1 min-w-0">
        <label htmlFor={inputId} className="text-sm font-medium">{def.label}</label>
        <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
        <p className="text-xs text-muted-foreground/80 mt-1">
          По умолчанию: {def.default} {def.unit}
          {changedAt && <> · изменено {new Date(changedAt).toLocaleDateString('ru-RU')}</>}
        </p>
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {def.options ? (
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger id={inputId} className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {def.options.map(o => <SelectItem key={o} value={String(o)}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={def.min}
            max={def.max}
            step={1}
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-24 tabular-nums"
            aria-invalid={!!error}
          />
        )}
        <span className="text-xs text-muted-foreground w-12">{def.unit}</span>
        <Button
          type="button" variant="ghost" size="icon" className="h-8 w-8"
          title="Вернуть значение по умолчанию"
          aria-label="Вернуть значение по умолчанию"
          disabled={isDefault && !changedAt}
          onClick={onReset}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
