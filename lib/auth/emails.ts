import { createAdminClient } from '@/lib/supabase/admin'

// Emails живут только в auth.users (в profiles их нет). Раньше страницы делали
// по одному admin.getUserById на пользователя (N+1 к Auth API); этот хелпер
// забирает всех постранично одним-двумя listUsers и отдаёт карту id → email.
export async function getEmailMap(ids: string[]): Promise<Record<string, string>> {
  const emailMap: Record<string, string> = {}
  if (ids.length === 0) return emailMap

  const wanted = new Set(ids)
  const admin = createAdminClient()
  const perPage = 1000

  for (let page = 1; page <= 10; page++) {  // защитный потолок 10k пользователей
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) break
    for (const u of data.users) {
      if (u.email && wanted.has(u.id)) emailMap[u.id] = u.email
    }
    if (data.users.length < perPage || Object.keys(emailMap).length >= wanted.size) break
  }
  return emailMap
}
