'use client'

import { useState, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Eye, EyeOff } from 'lucide-react'

// Поля учётки в окне редактирования — общие для карточек учеников
// (StudentsClient) и учителей (TeachersClient). Ролевые поля (класс, ник
// родителя) вставляются через afterName/afterTelegram.
export interface AccountFieldsValue {
  full_name: string
  telegram: string
  email: string
  password: string
}

// Ник без @ по краям; пустой — «отвязать»
export const cleanTelegram = (raw: string) => raw.trim().replace(/^@/, '')
export const isTelegramValid = (nick: string) => nick === '' || /^[A-Za-z0-9_]{5,32}$/.test(nick)

export function UserAccountFields({
  idPrefix, value, onChange, currentEmail, telegramHint, afterName, afterTelegram,
}: {
  idPrefix: string
  value: AccountFieldsValue
  onChange: (patch: Partial<AccountFieldsValue>) => void
  currentEmail?: string
  telegramHint: string
  afterName?: ReactNode
  afterTelegram?: ReactNode
}) {
  const [showPwd, setShowPwd] = useState(false)
  const telegramValid = isTelegramValid(cleanTelegram(value.telegram))

  return (
    <>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-name`}>Полное имя</Label>
        <Input
          id={`${idPrefix}-name`}
          value={value.full_name}
          onChange={(e) => onChange({ full_name: e.target.value })}
        />
      </div>
      {afterName}
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-tg`}>
          Ник Telegram <span className="text-muted-foreground text-xs">(необязательно)</span>
        </Label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
          <Input
            id={`${idPrefix}-tg`}
            value={value.telegram}
            onChange={(e) => onChange({ telegram: e.target.value.replace(/^@/, '') })}
            placeholder="username"
            className="pl-7"
          />
        </div>
        {!telegramValid && <p className="text-xs text-destructive">5–32 символа: латиница, цифры, _</p>}
        <p className="text-xs text-muted-foreground">{telegramHint}</p>
      </div>
      {afterTelegram}
      {currentEmail && (
        <div className="space-y-1">
          <Label className="text-muted-foreground">Текущий email</Label>
          <p className="text-sm px-3 py-2 rounded-md bg-muted text-muted-foreground font-mono break-all">{currentEmail}</p>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-email`}>Новый email <span className="text-muted-foreground text-xs">(необязательно)</span></Label>
        <Input
          id={`${idPrefix}-email`}
          type="email"
          // Браузер (особенно Chrome) агрессивно автозаполняет поля с
          // id/name, похожим на "email", сохранённым значением из
          // истории — уже ПОСЛЕ монтирования, минуя React `value`.
          // Живой инцидент: пустое поле при открытии формы, но DOM после
          // autofill содержал чужой email из истории браузера — сохранение
          // честно отправило его как "новый email", сервер упал на
          // уникальном индексе auth.users (другой пользователь уже занимает
          // этот email), а рассинхрон React state vs DOM после autofill
          // дальше давал hydration mismatch (React error #418) в консоли.
          autoComplete="off"
          value={value.email}
          onChange={(e) => onChange({ email: e.target.value })}
          placeholder="Оставьте пустым, чтобы не менять"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-pwd`}>Новый пароль <span className="text-muted-foreground text-xs">(необязательно)</span></Label>
        <div className="relative">
          <Input
            id={`${idPrefix}-pwd`}
            autoComplete="new-password"
            type={showPwd ? 'text' : 'password'}
            value={value.password}
            onChange={(e) => onChange({ password: e.target.value })}
            placeholder="Минимум 6 символов"
            className="pr-10"
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowPwd((v) => !v)}
            aria-label={showPwd ? 'Скрыть пароль' : 'Показать пароль'}
          >
            {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </>
  )
}
