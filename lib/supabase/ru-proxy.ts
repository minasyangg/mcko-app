// Доступ к сайту из РФ без VPN — через обратный прокси на сервере доски
// (Caddy: mcko.tutpad.ru → mcko-app.vercel.app). Браузеру нельзя ходить на
// *.supabase.co напрямую: API Supabase стоит за Cloudflare, который в РФ
// режется. Поэтому на прокси-домене всё, что браузер берёт у Supabase (API и
// файлы Storage), идёт через тот же домен по пути /sb/… — Caddy пересылает
// это в Supabase сам, минуя Vercel.
//
// Функции Vercel ходят в Supabase напрямую, как и раньше. Что страница открыта
// через прокси, сервер узнаёт по заголовку, который ставит Caddy, а браузер —
// по своему адресу. На mcko-app.vercel.app не меняется ничего.
//
// Откат: коммиты с префиксом [ru-proxy], до них — тег pre-ru-proxy.

export const RU_PROXY_HOSTS = ['mcko.tutpad.ru']
export const RU_PROXY_HEADER = 'x-mcko-proxy'
export const RU_PROXY_PATH = '/sb'

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
const STORAGE_PREFIX = `${SUPABASE_URL}/storage/v1/`

export function isRuProxyHost(hostname: string): boolean {
  return RU_PROXY_HOSTS.includes(hostname)
}

/**
 * Имя cookie сессии, под которым её ищут серверные клиенты: supabase-js строит
 * его из адреса Supabase. Браузерному клиенту на прокси-домене имя задаётся
 * явно — иначе оно вывелось бы из адреса прокси и сервер не увидел бы сессию.
 */
export function supabaseAuthCookieName(): string {
  return `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`
}

/** Ссылка на файл Storage через прокси. Ссылки не на наш Storage не трогаем. */
export function toRuProxyStorageUrl(url: string): string {
  return url.startsWith(STORAGE_PREFIX)
    ? `${RU_PROXY_PATH}/storage/v1/${url.slice(STORAGE_PREFIX.length)}`
    : url
}
