#!/usr/bin/env node
// Выполняет произвольный SQL напрямую в Postgres Supabase — замена вызову
// Supabase MCP (execute_sql) для скилов/агентов, у которых нет доступа к MCP
// (например, .claude/skills/book-answer-reviewer через subagent'ы).
//
// Вход — JSON через stdin: {"sql": "select ...; update ...;", "params": [...]}
//   - "sql" может содержать несколько стейтментов через ';' — каждый выполняется
//     по очереди на одном соединении; при >1 стейтменте обёрнуты в одну
//     транзакцию (BEGIN/COMMIT, ROLLBACK при ошибке любого из них).
//   - "params" ($1, $2, ...) поддерживаются только когда "sql" — один стейтмент;
//     обычно не нужны — существующие запросы скила уже подставляют значения
//     литералами в текст SQL.
// Выход — JSON через stdout: {"results": [{"command","rowCount","rows"?}, ...]}
//   - SELECT → {"command":"SELECT","rowCount":N,"rows":[...]}
//   - UPDATE/INSERT/DELETE → {"command":"UPDATE","rowCount":N}
//   - Ошибка (подключение или SQL) → {"error": "..."} на stdout, exit code 1.
//
// Нужен env SUPABASE_DB_URL (или DATABASE_URL/POSTGRES_URL) — строка
// подключения Postgres из Supabase Dashboard → Project Settings → Database →
// Connection string → URI (для локального supabase start — вывод `npx
// supabase status`, строка "DB URL"). Ищется в env, затем в .env.local /
// .env.development.local (по аналогии с scripts/book-import.mjs).
// Использовать строку Session pooler (не Direct connection) — direct-хост
// резолвится в IPv6-only адрес, который недоступен из многих сетей; pooler
// всегда на IPv4. Подключение всегда через SSL (см. ниже про rejectUnauthorized).
//
// echo '{"sql":"select id from books limit 1"}' | node scripts/supabase-query.mjs

import fs from 'node:fs'

function loadEnv() {
  for (const f of ['.env.local', '.env.development.local']) {
    if (!fs.existsSync(f)) continue
    for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  }
}
loadEnv()

function fail(message) {
  console.log(JSON.stringify({ error: message }))
  process.exit(1)
}

const connectionString =
  process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL

if (!connectionString) {
  fail(
    'Нет SUPABASE_DB_URL / DATABASE_URL / POSTGRES_URL (env, .env.local или .env.development.local). ' +
      'Строка подключения Postgres берётся в Supabase Dashboard → Project Settings → Database → Connection string → URI.'
  )
}

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)

let input
try {
  input = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
} catch {
  fail('Некорректный JSON на stdin — ожидается {"sql": "...", "params"?: [...]}')
}

const { sql, params } = input
if (typeof sql !== 'string' || !sql.trim()) fail('sql required')

// Разбивает на стейтменты по ';', но не внутри одинарно-кавыченных строковых
// литералов (с учётом '' как экранированной кавычки внутри строки) — наивный
// sql.split(';') ломал транзакцию, если сам текст ответа задания содержал ';'
// (например "0.3; осталось 52 тонны"), см. .claude/memory/progress.md.
function splitStatements(text) {
  const parts = []
  let current = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "'") {
      if (inString && text[i + 1] === "'") {
        current += "''"
        i++
        continue
      }
      inString = !inString
      current += ch
      continue
    }
    if (ch === ';' && !inString) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
}

const statements = splitStatements(sql)
  .map(s => s.trim())
  .filter(Boolean)

if (statements.length === 0) fail('sql пуст после разбора стейтментов')
if (params !== undefined && statements.length > 1) {
  fail('params поддерживаются только для одного стейтмента — уберите params или не батчите через ";"')
}

const { Client } = await import('pg')
// Supabase (pooler и direct) требует SSL; сертификат пула не всегда проходит
// строгую цепочку доверия на клиенте — rejectUnauthorized:false здесь стандартная
// рекомендация самого Supabase для внешних pg-клиентов, не ослабление ради удобства.
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })

try {
  await client.connect()
} catch (err) {
  fail(`Не удалось подключиться к БД: ${err.message}`)
}

const results = []
try {
  if (statements.length > 1) await client.query('BEGIN')

  for (const statement of statements) {
    const res = await client.query(statement, statements.length === 1 ? params : undefined)
    results.push(
      res.command === 'SELECT'
        ? { command: res.command, rowCount: res.rowCount, rows: res.rows }
        : { command: res.command, rowCount: res.rowCount }
    )
  }

  if (statements.length > 1) await client.query('COMMIT')
} catch (err) {
  if (statements.length > 1) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore rollback failure — соединение всё равно закрываем ниже
    }
  }
  await client.end()
  fail(`Ошибка SQL: ${err.message}`)
}

await client.end()
console.log(JSON.stringify({ results }))
