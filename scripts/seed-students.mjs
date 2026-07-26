/**
 * Seed script: creates 12 students for class 7, organization "uspeh"
 *
 * Требует SUPABASE_URL и SERVICE_ROLE_KEY в окружении (без дефолтов —
 * секретные ключи в коде не хранятся).
 * Prod:  SUPABASE_URL="https://<ref>.supabase.co" SERVICE_ROLE_KEY="<key>" node scripts/seed-students.mjs
 * Local: $env:SUPABASE_URL="http://localhost:54321"; $env:SERVICE_ROLE_KEY="<key>"; node scripts/seed-students.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Нет SUPABASE_URL / SERVICE_ROLE_KEY в окружении.')
  process.exit(1)
}

console.log(`🔗 Supabase URL: ${SUPABASE_URL}`)

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const GRADE = '7'
const PASSWORD = 'uspeh'

const STUDENTS = [
  { full_name: 'Артемчикова Мария',    email: 'martemchikova@uspeh.ru' },
  { full_name: 'Васильева Милана',     email: 'mvasilieva@uspeh.ru' },
  { full_name: 'Гайдук Артем',         email: 'agayduk@uspeh.ru' },
  { full_name: 'Грызлов Дмитрий',      email: 'dgryzlov@uspeh.ru' },
  { full_name: 'Зайцев Степан',        email: 'szaicev@uspeh.ru' },
  { full_name: 'Зотов Арсений',        email: 'azotov@uspeh.ru' },
  { full_name: 'Ильичева Мария',       email: 'milicheva@uspeh.ru' },
  { full_name: 'Климычович Алексей',   email: 'aklimychovich@uspeh.ru' },
  { full_name: 'Коровлев Георгий',     email: 'gkorovlev@uspeh.ru' },
  { full_name: 'Милованов Марк',       email: 'mmilovanov@uspeh.ru' },
  { full_name: 'Плешков Егор',         email: 'epleshkov@uspeh.ru' },
  { full_name: 'Сехин Егор',           email: 'esehin@uspeh.ru' },
]

async function main() {
  // Get the organization ID (use the first one found)
  const { data: orgs, error: orgErr } = await admin.from('organizations').select('id, name').limit(1)
  if (orgErr || !orgs?.length) {
    console.error('❌ Could not find organization:', orgErr?.message)
    process.exit(1)
  }
  const orgId = orgs[0].id
  console.log(`✓ Organization: "${orgs[0].name}" (${orgId})\n`)

  let created = 0
  let skipped = 0

  for (const student of STUDENTS) {
    const { full_name, email } = student

    // Create auth user
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name, role: 'student' },
    })

    if (authErr) {
      if (authErr.message.includes('already') || authErr.message.includes('registered')) {
        console.log(`  ⚠ Пропущен (уже существует): ${full_name} <${email}>`)
        skipped++
      } else {
        console.error(`  ✗ Ошибка создания ${full_name}: ${authErr.message}`)
      }
      continue
    }

    const userId = authData.user.id

    // Update profile with org, grade, role
    const { error: profileErr } = await admin
      .from('profiles')
      .update({ organization_id: orgId, grade: GRADE, full_name, role: 'student' })
      .eq('id', userId)

    if (profileErr) {
      console.error(`  ✗ Ошибка профиля ${full_name}: ${profileErr.message}`)
      continue
    }

    console.log(`  ✓ Создан: ${full_name} <${email}>`)
    created++
  }

  console.log(`\n✅ Готово: создано ${created}, пропущено ${skipped} из ${STUDENTS.length}`)
}

main().catch(e => { console.error(e); process.exit(1) })
