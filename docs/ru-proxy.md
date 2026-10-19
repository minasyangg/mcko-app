# Доступ из РФ без VPN: обратный прокси mcko.tutpad.ru

Сайт по-прежнему работает на Vercel (`mcko-app.vercel.app`), база — в Supabase.
Для пользователей из РФ перед ними стоит обратный прокси на сервере доски
(SpaceWeb, Санкт-Петербург, `ssh -p 3599 root@168.222.203.230`, Caddy). У
пользователя ничего не ставится: он просто открывает `https://mcko.tutpad.ru`.

```
браузер ─► mcko.tutpad.ru/…     ─► mcko-app.vercel.app   (страницы и /api)
браузер ─► mcko.tutpad.ru/sb/…  ─► <ref>.supabase.co     (вход, запросы из браузера, картинки Storage)
Vercel  ─► Supabase, Telegram, DeepSeek, PaddleOCR — напрямую, как раньше
```

Зачем `/sb/`: браузер ходит в Supabase сам, а API Supabase стоит за Cloudflare,
который в РФ режется. Через прокси эти запросы идут с российского адреса.

## Код

- `lib/supabase/ru-proxy.ts` — список прокси-доменов, заголовок `x-mcko-proxy`,
  перевод ссылок Storage на `/sb/…`, имя cookie сессии.
- `lib/supabase/client.ts` — на прокси-домене браузерный клиент берёт адрес
  `/sb/` и явное имя cookie (то же, что у серверных клиентов).
- `app/layout.tsx` + `components/shared/StorageUrlProvider.tsx` — сервер по
  заголовку прокси решает, как отдавать ссылки на картинки; компоненты картинок
  берут адрес через `useStorageUrl()`.

На `mcko-app.vercel.app` поведение не меняется: заголовка прокси там нет.

## Блок Caddy

Добавляется в `/etc/caddy/Caddyfile` отдельным сайтом; блок доски не меняется.

```caddy
# Сайт mcko-app для доступа из РФ без VPN (docs/ru-proxy.md в репозитории mcko-app).
mcko.tutpad.ru {
	# Запросы браузера к Supabase — прямо в Supabase, минуя Vercel
	handle_path /sb/* {
		reverse_proxy https://zcfgyfugxtbnqrcjfifo.supabase.co {
			header_up Host zcfgyfugxtbnqrcjfifo.supabase.co
			header_up -X-Forwarded-Host
		}
	}
	handle {
		reverse_proxy https://mcko-app.vercel.app {
			header_up Host mcko-app.vercel.app
			# Без X-Forwarded-Host: иначе /api/telegram/setup поставил бы webhook
			# на этот домен, а Telegram до российских серверов не достаёт
			header_up -X-Forwarded-Host
			header_up X-Mcko-Proxy "1"
			# Редиректы Vercel (после входа и т.п.) возвращаем на этот домен
			header_down Location "^https://mcko-app\.vercel\.app" "https://mcko.tutpad.ru"
		}
	}
}
```

Применять вне занятий: при `reload` Caddy закрывает открытые WebSocket-соединения
доски, и клиенты переподключаются.

```sh
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
```

## Настройки вне кода

- DNS (панель SpaceWeb, зона tutpad.ru): A-запись `mcko` → `168.222.203.230`.
- Supabase → Authentication → URL Configuration: добавить `https://mcko.tutpad.ru/**`
  в Redirect URLs.
- Supabase → Authentication → Rate Limits: все входы через прокси идут с одного
  IP, поэтому лимит входов на IP нужно поднять, иначе класс, входящий
  одновременно, упрётся в лимит.
- Webhook Telegram регистрировать только с `mcko-app.vercel.app`.

## Подготовка сервера (сделана 2026-10-21)

- Копия конфига: `/etc/caddy/Caddyfile.pre-ru-proxy`.
- Swap 1 ГБ (`/swapfile`, `vm.swappiness=10`) — раньше swap не было, и при
  нехватке памяти первой убивалась бы доска.
- Журнал ограничен 200 МБ (`/etc/systemd/journald.conf.d/00-ru-proxy-size.conf`),
  было 1 ГБ.
- Снимок ресурсов «до»: `/root/ru-proxy-baseline-*.txt`; памятка по откату:
  `/root/RU-PROXY-ROLLBACK.txt`.

## Откат

1. **Только прокси** (если доске стало хуже) — вернуть конфиг Caddy, секунды:
   ```sh
   cp -p /etc/caddy/Caddyfile.pre-ru-proxy /etc/caddy/Caddyfile \
     && caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
   ```
   Сайт продолжит работать на `mcko-app.vercel.app`.
2. **Код** — `git revert` коммитов с префиксом `[ru-proxy]`
   (`git log --oneline --grep='\[ru-proxy\]'`); состояние до них — тег `pre-ru-proxy`.
3. **Подготовка сервера** обычно не откатывается — она доске только помогает.
   Команды есть в `/root/RU-PROXY-ROLLBACK.txt`.

Признаки для отката: свободной памяти меньше 200 МБ (Grafana на сервере), жалобы
на задержки в доске.
