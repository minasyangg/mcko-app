import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'
import { RU_PROXY_PATH, isRuProxyHost, supabaseAuthCookieName } from './ru-proxy'

export function createClient() {
  // Через прокси в РФ браузер ходит в Supabase через тот же домен
  // (lib/supabase/ru-proxy.ts); на остальных адресах — напрямую, как раньше.
  if (typeof window !== 'undefined' && isRuProxyHost(window.location.hostname)) {
    return createBrowserClient<Database>(
      `${window.location.origin}${RU_PROXY_PATH}`,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookieOptions: { name: supabaseAuthCookieName() } }
    )
  }
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
