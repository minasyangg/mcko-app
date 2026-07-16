/**
 * One-off remediation: solution_media images were historically uploaded to the
 * PUBLIC task-media bucket (bug, fixed in app/api/parsing/trigger/route.ts) —
 * anyone with the URL could read exam solution images without going through
 * the solution_requests approval gate. This moves every affected file to the
 * private solution-media bucket, updates the DB pointer, then deletes the
 * public copy.
 *
 * Требует SUPABASE_URL и SERVICE_ROLE_KEY в окружении (без дефолтов).
 * Prod: SUPABASE_URL="https://<ref>.supabase.co" SERVICE_ROLE_KEY="<key>" node scripts/migrate-solution-media.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Нет SUPABASE_URL / SERVICE_ROLE_KEY в окружении.')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  const { data: rows, error } = await admin
    .from('solution_media')
    .select('id, storage_path')
    .like('storage_path', 'task-media/%')

  if (error) {
    console.error('❌ Не удалось прочитать solution_media:', error.message)
    process.exit(1)
  }

  if (!rows?.length) {
    console.log('✅ Нечего переносить — все solution_media уже в приватном bucket.')
    return
  }

  console.log(`Найдено ${rows.length} файлов в task-media (public), переношу в solution-media (private)...\n`)

  let moved = 0
  let failed = 0

  for (const row of rows) {
    const oldPath = row.storage_path
    const newPath = oldPath.replace(/^task-media\//, '')

    try {
      const { data: fileBlob, error: dlErr } = await admin.storage.from('task-media').download(oldPath)
      if (dlErr || !fileBlob) throw new Error(dlErr?.message ?? 'download returned no data')

      const buffer = Buffer.from(await fileBlob.arrayBuffer())

      const { error: upErr } = await admin.storage
        .from('solution-media')
        .upload(newPath, buffer, { contentType: fileBlob.type || 'image/webp', upsert: true })
      if (upErr) throw new Error(`upload: ${upErr.message}`)

      const { error: updErr } = await admin
        .from('solution_media')
        .update({ storage_path: newPath })
        .eq('id', row.id)
      if (updErr) throw new Error(`db update: ${updErr.message}`)

      const { error: rmErr } = await admin.storage.from('task-media').remove([oldPath])
      if (rmErr) console.warn(`  ⚠ перенесено, но не удалилась публичная копия ${oldPath}: ${rmErr.message}`)

      console.log(`  ✓ ${oldPath} → solution-media/${newPath}`)
      moved++
    } catch (e) {
      console.error(`  ✗ ${oldPath}: ${e.message}`)
      failed++
    }
  }

  console.log(`\n✅ Готово: перенесено ${moved}, ошибок ${failed} из ${rows.length}`)
}

main().catch(e => { console.error(e); process.exit(1) })
