#!/usr/bin/env node
// Применяет миграцию из supabase/migrations к облачной базе одной транзакцией
// и записывает её в историю (supabase_migrations.schema_migrations) — как это
// делает Supabase MCP apply_migration, но с этой машины.
//
//   node scripts/apply-migration.mjs 111_dispatch_every_30_min            — применить
//   node scripts/apply-migration.mjs 111_dispatch_every_30_min --dry-run  — выполнить и откатить
//
// Подключение — SUPABASE_DB_URL из env или .env.local (Session pooler).
// Прямое подключение с машины разработки ненадёжно: часть попыток зависает
// на рукопожатии, а иногда обрывается уже открытое соединение (сетевой экран
// антивируса). Отсюда:
//   * подключение повторяется до 6 раз с таймаутом 15 с;
//   * у каждого запроса таймаут на стороне клиента, весь запуск — 3 минуты;
//   * idle_in_transaction_session_timeout: если клиент пропал посреди
//     транзакции, база сама откатит её через 30 с и снимет блокировки
//     (живой случай 2026-11-15: commit не дошёл, транзакция висела открытой
//     и держала cron.job);
//   * если ответ на commit потерялся, скрипт переподключается и проверяет
//     по истории миграций, применилась ли она.
// Повторно уже записанную в историю миграцию не применяет.

import fs from 'node:fs'
import path from 'node:path'

const [name, flag] = process.argv.slice(2)
const dryRun = flag === '--dry-run'
if (!name || (flag && !dryRun)) {
  console.log('Использование: node scripts/apply-migration.mjs <имя миграции без .sql> [--dry-run]')
  process.exit(1)
}

const file = path.join('supabase', 'migrations', `${name.replace(/\.sql$/, '')}.sql`)
if (!fs.existsSync(file)) {
  console.log(`Нет файла ${file}`)
  process.exit(1)
}
const migrationName = path.basename(file, '.sql')
const sql = fs.readFileSync(file, 'utf8')

for (const f of ['.env.local', '.env.development.local']) {
  if (!fs.existsSync(f)) continue
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL
if (!connectionString) {
  console.log('Нет SUPABASE_DB_URL (env или .env.local)')
  process.exit(1)
}

setTimeout(() => {
  console.log('Не уложились в 3 минуты — прерываю. Транзакция не закоммичена, база не изменена.')
  process.exit(1)
}, 180_000).unref()

const { Client } = await import('pg')

async function connect() {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000, query_timeout: 70_000 })
    // Обрыв соединения pg сообщает событием 'error' на клиенте; без слушателя
    // Node роняет весь процесс («Connection terminated unexpectedly», живой
    // случай 2026-11-26) мимо повторов и отката ниже. Со слушателем обрыв
    // приходит обычной ошибкой текущего/следующего запроса.
    client.on('error', (e) => console.log(`соединение оборвалось: ${e.message}`))
    try {
      await client.connect()
      if (attempt > 1) console.log(`подключено с ${attempt}-й попытки`)
      return client
    } catch (e) {
      console.log(`попытка подключения ${attempt}: ${e.message}`)
      await client.end().catch(() => {})
    }
  }
  throw new Error('не удалось подключиться к базе за 6 попыток')
}

// Записана ли миграция в историю — отдельным соединением, когда ответ на
// commit потерялся и состояние исходного соединения неизвестно
async function recordedVersion() {
  const check = await connect()
  try {
    const { rows } = await check.query('select version from supabase_migrations.schema_migrations where name = $1', [migrationName])
    return rows[0]?.version ?? null
  } finally {
    await check.end().catch(() => {})
  }
}

let client
let committed = false
try {
  client = await connect()
  await client.query('begin')
  // не встаём в очередь за чужой долгой транзакцией, не висим на тяжёлом
  // запросе и не оставляем открытую транзакцию, если клиент пропал
  await client.query(`set local lock_timeout = '5s'; set local statement_timeout = '60s'; set local idle_in_transaction_session_timeout = '30s'`)

  const { rows: [{ already }] } = await client.query(
    'select count(*)::int as already from supabase_migrations.schema_migrations where name = $1', [migrationName])
  if (already) throw new Error(`миграция ${migrationName} уже записана в историю — повторно не применяю`)

  await client.query(sql)

  if (dryRun) {
    console.log(`Пробный прогон ${migrationName}: выполнена без ошибок, откатываю — база не изменена.`)
  } else {
    const { rows: [{ version }] } = await client.query(
      `insert into supabase_migrations.schema_migrations (version, name, statements)
       values (to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS'), $1, array[$2]) returning version`,
      [migrationName, sql])
    try {
      await client.query('commit')
      committed = true
      console.log(`Применено и закоммичено: ${migrationName}, версия ${version}`)
    } catch (e) {
      // ответ на commit не дошёл — неизвестно, применилась ли миграция
      committed = true // откатывать нечего: соединение потеряно, транзакция либо закоммичена, либо откатится базой
      console.log(`ответ на commit не получен (${e.message}), проверяю по истории миграций…`)
      await client.end().catch(() => {})
      client = null
      const recorded = await recordedVersion()
      if (recorded) console.log(`Применено и закоммичено: ${migrationName}, версия ${recorded}`)
      else {
        console.log(`НЕ применено: ${migrationName} нет в истории — база откатила транзакцию. Запустите команду ещё раз.`)
        process.exitCode = 1
      }
    }
  }
} catch (e) {
  console.log(`НЕ применено: ${e.message}`)
  process.exitCode = 1
} finally {
  if (client && !committed) await client.query('rollback').catch(() => {})
  await client?.end().catch(() => {})
}
