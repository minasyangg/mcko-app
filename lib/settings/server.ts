import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_SETTINGS, normalizeSettings, type AppSettings } from '@/lib/settings/registry'

/**
 * Настройки системы (app_settings, 114) — один запрос на запрос страницы
 * (react cache). Таблица недоступна или пуста — значения по умолчанию:
 * сбой чтения настроек не должен ломать ни кабинет, ни проверку доступа.
 */
export const getAppSettings = cache(async (): Promise<AppSettings> => {
  try {
    const { data, error } = await createAdminClient()
      .from('app_settings')
      .select('key, value')
      .limit(100)
    if (error) return DEFAULT_SETTINGS
    return normalizeSettings(data)
  } catch {
    return DEFAULT_SETTINGS
  }
})
