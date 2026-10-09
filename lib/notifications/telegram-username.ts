import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export interface TelegramNickHolder {
  id: string
  full_name: string
  organization_id: string | null
}

// Ник Telegram — ключ, по которому webhook /start находит профиль, поэтому
// он обязан указывать на одного получателя: свой ник (telegram_username) и
// ник родителя ученика (parent_telegram_username) ищутся вместе, регистр не
// важен, удалённые профили не в счёт. Раньше ник ничем не защищался, и
// второй аккаунт того же человека с тем же ником перехватывал привязку бота
// (живой случай 2026-10-10). Гарантия — триггер в БД (миграция 097), здесь
// то же правило проверяется до записи, чтобы показать понятный текст.
export async function findTelegramNickMatches(admin: AdminClient, username: string) {
  // _ и % — wildcard'ы LIKE, экранируем, чтобы john_doe не совпал с johnXdoe
  const escaped = username.replace(/[\\%_]/g, '\\$&')
  const [own, parent] = await Promise.all([
    admin.from('profiles').select('id, full_name, organization_id')
      .ilike('telegram_username', escaped).is('deleted_at', null).limit(10),
    admin.from('profiles').select('id, full_name, organization_id')
      .ilike('parent_telegram_username', escaped).is('deleted_at', null).limit(10),
  ])
  if (own.error) throw own.error
  if (parent.error) throw parent.error
  return { own: own.data ?? [], parent: parent.data ?? [] }
}

// Кто, кроме профиля excludeId, уже держит ник. Совпадение своего ника с
// ником родителя на ОДНОМ профиле сюда не попадает — его вызывающий
// проверяет сам по итоговым значениям обоих полей.
export async function findTelegramNickHolder(
  admin: AdminClient,
  username: string,
  excludeId?: string,
): Promise<(TelegramNickHolder & { asParent: boolean }) | null> {
  const { own, parent } = await findTelegramNickMatches(admin, username)
  const asOwn = own.find(p => p.id !== excludeId)
  if (asOwn) return { ...asOwn, asParent: false }
  const asParent = parent.find(p => p.id !== excludeId)
  return asParent ? { ...asParent, asParent: true } : null
}

export const sameTelegramNick = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase()

// Ошибка триггера уникальности (миграция 097): запись обошла проверку выше
// гонкой. Текст ошибки уже человекочитаемый.
export function isTelegramNickTakenError(error: { hint?: string | null } | null | undefined): boolean {
  return error?.hint === 'telegram_username_taken'
}

// Для самого пользователя: чей это профиль, не раскрываем.
export const TELEGRAM_NICK_TAKEN_SELF =
  'Этот ник Telegram уже указан в другом аккаунте платформы. ' +
  'Если у вас два аккаунта — обратитесь к администратору.'

export const TELEGRAM_NICK_SAME_AS_PARENT =
  'Ник ученика и ник родителя совпадают — у ученика и родителя должны быть разные аккаунты Telegram.'

// Для админа: имя владельца — только внутри его организации.
export function telegramNickTakenForAdmin(
  username: string,
  holder: TelegramNickHolder & { asParent: boolean },
  orgId: string | null,
): string {
  const where = holder.organization_id === orgId
    ? `у профиля «${holder.full_name}»${holder.asParent ? ' (как ник родителя)' : ''}`
    : 'в другом профиле платформы'
  return `Ник @${username} уже указан ${where}. Один ник — один получатель уведомлений.`
}
