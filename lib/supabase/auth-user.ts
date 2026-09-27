import type { SupabaseClient, UserAppMetadata, UserMetadata } from '@supabase/supabase-js'

export interface AuthUser {
  id: string
  email?: string
  user_metadata: UserMetadata
  app_metadata: UserAppMetadata
}

// Замена supabase.auth.getUser() для серверного кода. getUser() на каждый вызов
// ходит в Auth-сервер (сетевой round-trip до Supabase), а страница/роут
// дёргали его по 2-3 раза за запрос (proxy + layout + page). Проект подписывает
// JWT асимметричным ключом (ES256), поэтому getClaims() проверяет подпись
// локально по закешированному JWKS — без сети. Истёкший токен getClaims()
// сперва обновляет, как и getUser().
//
// Возвращает ту же форму { data: { user }, error }, что и getUser(), чтобы
// замена в вызывающем коде была механической.
export async function getAuthUser(supabase: Pick<SupabaseClient, 'auth'>) {
  const { data, error } = await supabase.auth.getClaims()
  const c = data?.claims
  const user: AuthUser | null = c?.sub
    ? {
        id: c.sub,
        email: c.email,
        user_metadata: c.user_metadata ?? {},
        app_metadata: c.app_metadata ?? {},
      }
    : null
  return { data: { user }, error }
}
