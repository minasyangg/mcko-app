#!/usr/bin/env node
// Перезаливка картинок задач книги в Storage (bucket book-media) для книги,
// УЖЕ существующей в БД — отдельно от полного book-import.mjs. Нужен, когда
// заливка картинок при первом импорте не завершилась (зависание сети — см.
// project_local_env_limits) и книгу пересобирать полностью не хочется:
// сами задания/страницы уже вставлены, тут только заменяются <img src>.
//
// Использование:
//   node scripts/book-fix-images.mjs --book-id <uuid> [--images-concurrency N]
//
// Идемпотентен: находит только страницы/задания, где markdown/prompt_md ещё
// содержит внешний bcebos-URL, остальные не трогает. Можно перезапускать
// сколько угодно раз при обрыве сети — незалитые картинки просто закачаются
// на следующий прогон, уже готовые не перекачиваются повторно.
//
// Нужны env: SUPABASE_URL (или NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
// (или .env.import.local / .env.local — как у book-import.mjs).

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
function flag(name) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const bookId = flag('book-id')
if (!bookId) {
  console.error('Usage: node scripts/book-fix-images.mjs --book-id <uuid> [--images-concurrency N]')
  process.exit(1)
}

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

async function withRetry(fn, label, attempts = 3) {
  let result
  for (let i = 1; i <= attempts; i++) {
    try { result = await fn() } catch (e) { result = { error: e } }
    if (!result?.error) return result
    if (i === attempts) return result
    console.warn(`  ${label}: попытка ${i} не удалась (${result.error.message}), повтор через ${i}с...`)
    await new Promise(r => setTimeout(r, i * 1000))
  }
  return result
}

const BCEBOS_RE = /https:\/\/pplines-online\.bj\.bcebos\.com\/[^"')\s]+/g

const { data: book, error: bookErr } = await db.from('books').select('id, title').eq('id', bookId).single()
if (bookErr || !book) { console.error('Книга не найдена:', bookErr?.message ?? bookId); process.exit(1) }
console.log(`Книга: ${book.title} (${bookId})`)

const { data: pages, error: pagesErr } = await db.from('book_pages').select('page_index, markdown').eq('book_id', bookId)
if (pagesErr) { console.error('book_pages:', pagesErr.message); process.exit(1) }
const { data: problems, error: probErr } = await db.from('book_problems').select('task_number, prompt_md').eq('book_id', bookId)
if (probErr) { console.error('book_problems:', probErr.message); process.exit(1) }

const uniqueUrls = new Set()
for (const p of pages) for (const m of p.markdown.matchAll(BCEBOS_RE)) uniqueUrls.add(m[0])
for (const pr of problems) for (const m of pr.prompt_md.matchAll(BCEBOS_RE)) uniqueUrls.add(m[0])

if (uniqueUrls.size === 0) {
  console.log('Внешних bcebos-ссылок не найдено — все картинки уже перезалиты.')
  process.exit(0)
}
console.log(`Найдено ${uniqueUrls.size} непереlitых картинок.`)

const IMAGES_CONCURRENCY = Math.max(1, parseInt(flag('images-concurrency') ?? '1') || 1)
const urlToStorage = new Map()
let uploaded = 0, failed = 0
const queue = [...uniqueUrls]

async function worker() {
  while (queue.length > 0) {
    const externalUrl = queue.shift()
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      let res
      try {
        res = await fetch(externalUrl, { signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // чтение тела потока — signal аборта fetch гарантирует прерывание только
      // до получения заголовков, не во время самого стриминга; отдельный
      // таймаут на arrayBuffer() тоже нужен (зависание наблюдалось именно тут)
      const buf = Buffer.from(await Promise.race([
        res.arrayBuffer(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('body read timeout')), 15_000)),
      ]))
      const pathPart = new URL(externalUrl).pathname
      const ext = (path.extname(pathPart) || '.jpg').toLowerCase()
      const contentType = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[ext] ?? 'image/jpeg'
      const filename = path.basename(pathPart).replace(/[^a-zA-Z0-9._-]/g, '_') || `img_${uploaded + failed}${ext}`
      const storagePath = `${bookId}/${filename}`
      // upload сам по себе может зависнуть так же, как fetch — withRetry ждёт
      // fn() бесконечно без внешнего таймаута, поэтому оборачиваем каждую
      // попытку в Promise.race, иначе весь процесс виснет на одной картинке
      const { error: upErr } = await withRetry(
        () => Promise.race([
          db.storage.from('book-media').upload(storagePath, buf, { contentType, upsert: true }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('upload timeout')), 20_000)),
        ]),
        `upload ${filename}`,
      )
      if (upErr) throw new Error(upErr.message)
      const { data: pub } = db.storage.from('book-media').getPublicUrl(storagePath)
      urlToStorage.set(externalUrl, pub.publicUrl)
      uploaded++
    } catch (e) {
      console.warn(`  не удалось (${e.message}): ${externalUrl.slice(0, 100)}…`)
      failed++
    }
    if ((uploaded + failed) % 10 === 0) console.log(`  ...${uploaded + failed}/${uniqueUrls.size}`)
  }
}
await Promise.all(Array.from({ length: IMAGES_CONCURRENCY }, worker))
console.log(`Картинок перезалито: ${uploaded}, не удалось: ${failed}`)

if (urlToStorage.size > 0) {
  console.log('Обновление ссылок...')
  for (const p of pages) {
    let md = p.markdown
    for (const [u, s] of urlToStorage) md = md.replaceAll(u, s)
    if (md !== p.markdown) {
      const { error } = await withRetry(
        () => db.from('book_pages').update({ markdown: md }).eq('book_id', bookId).eq('page_index', p.page_index),
        `book_pages@${p.page_index}`,
      )
      if (error) console.error(`book_pages update@${p.page_index}:`, error.message)
    }
  }
  for (const pr of problems) {
    let prompt = pr.prompt_md
    for (const [u, s] of urlToStorage) prompt = prompt.replaceAll(u, s)
    if (prompt !== pr.prompt_md) {
      const { error } = await withRetry(
        () => db.from('book_problems').update({ prompt_md: prompt }).eq('book_id', bookId).eq('task_number', pr.task_number),
        `book_problems@${pr.task_number}`,
      )
      if (error) console.error(`book_problems update@${pr.task_number}:`, error.message)
    }
  }
  console.log('Готово.')
}
