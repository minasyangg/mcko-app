'use client'

import { createContext, useCallback, useContext } from 'react'
import { toRuProxyStorageUrl } from '@/lib/supabase/ru-proxy'

// Открыта ли страница через прокси в РФ (lib/supabase/ru-proxy.ts). Решает
// сервер по заголовку прокси и передаёт сюда из корневого layout — так ссылка
// на картинку одинакова при серверном рендере и в браузере, без расхождений
// при гидрации.
const ViaRuProxyContext = createContext(false)

export function StorageUrlProvider({
  viaRuProxy, children,
}: { viaRuProxy: boolean; children: React.ReactNode }) {
  return <ViaRuProxyContext.Provider value={viaRuProxy}>{children}</ViaRuProxyContext.Provider>
}

/** Переводит ссылку на файл Storage в адрес, который откроется у этого пользователя. */
export function useStorageUrl(): (url: string) => string {
  const viaRuProxy = useContext(ViaRuProxyContext)
  return useCallback(
    (url: string) => (viaRuProxy && url ? toRuProxyStorageUrl(url) : url),
    [viaRuProxy],
  )
}
