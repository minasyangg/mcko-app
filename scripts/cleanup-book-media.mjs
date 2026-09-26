#!/usr/bin/env node
// Удаляет все файлы книги из Storage bucket book-media по book_id (папка
// "<bookId>/..."). Используется после удаления самой книги из БД (books —
// см. book-import*.mjs), чтобы не оставлять "осиротевшие" картинки в Storage.
//
// Использование:
//   node scripts/cleanup-book-media.mjs <bookId>
//
// Нужны env (или .env.import.local/.env.local):
//   SUPABASE_URL (или NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

import fs from 'node:fs'

function loadEnv() {
  for (const f of ['.env.import.local', '.env.local', '.env.development.local']) {
    if (!fs.existsSync(f)) continue
    for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  }
}
loadEnv()
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env или .env.import.local).')
  process.exit(1)
}

const { createClient } = await import('@supabase/supabase-js')
const db = createClient(url, key)

const bookId = process.argv[2]
if (!bookId) { console.error('Usage: node scripts/cleanup-book-media.mjs <bookId>'); process.exit(1) }

let total = 0
while (true) {
  const { data, error } = await db.storage.from('book-media').list(bookId, { limit: 100 })
  if (error) { console.error('list:', error.message); process.exit(1) }
  if (!data || data.length === 0) break
  const paths = data.map(f => `${bookId}/${f.name}`)
  const { error: delErr } = await db.storage.from('book-media').remove(paths)
  if (delErr) { console.error('remove:', delErr.message); process.exit(1) }
  total += paths.length
  console.log(`Удалено ${paths.length} (всего ${total})`)
  if (data.length < 100) break
}
console.log(`Готово. Всего удалено файлов: ${total}`)
