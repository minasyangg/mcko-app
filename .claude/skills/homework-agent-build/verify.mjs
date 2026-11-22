// Проверка собранных черновиков: состав, ключи, баллы, вложения (HTML-заглушки
// вместо картинок) и прогон эталонов через настоящий checkAnswer.
// Запуск из корня репозитория:
//   node .claude/skills/homework-agent-build/verify.mjs <built.json> [--fix-media]
// built.json пишет build.mjs рядом со спецификацией.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const builtPath = path.resolve(process.argv[2] ?? '')
if (!process.argv[2] || !fs.existsSync(builtPath)) { console.error('укажите путь к built.json'); process.exit(1) }
const repo = process.cwd()
const require = createRequire(path.join(repo, 'package.json'))
const { createJiti } = require('jiti')
const jiti = createJiti(path.join(repo, 'x.ts'), { alias: { '@': repo } })
const { checkAnswer } = await jiti.import('@/lib/grading/checker')

function sql(text) {
  const r = spawnSync('node', ['scripts/supabase-query.mjs'], { cwd: repo, input: JSON.stringify({ sql: text }), encoding: 'utf8' })
  const out = JSON.parse(r.stdout)
  if (out.error) throw new Error(out.error)
  return out.results
}

const built = JSON.parse(fs.readFileSync(builtPath, 'utf8'))
const fix = process.argv.includes('--fix-media')

for (const [key, b] of Object.entries(built)) {
  const [tasks] = sql(`
    select tt.id, tt.task_number, tt.task_type, tt.grading_method, tt.max_score, tt.has_images, tt.review_status,
           k.correct_answer, k.grading_method kgm, k.grading_config,
           (select count(*) from task_solutions s where s.task_id = tt.id) sol
    from test_tasks tt left join task_answer_keys k on k.task_id = tt.id
    where tt.test_version_id = '${b.versionId}' order by tt.task_number`)
  const rows = tasks.rows
  const total = rows.reduce((s, r) => s + Number(r.max_score), 0)
  const nums = rows.map(r => r.task_number).join(',')
  console.log(`\n== ${b.title} (${b.testId}): ${rows.length} заданий, ${total} баллов; номера ${nums}`)

  for (const r of rows) {
    if (!r.correct_answer) { console.log(`  №${r.task_number}: НЕТ КЛЮЧА`); continue }
    if (r.kgm === 'manual') continue
    // составной эталон {parts: {label: {value}}} — ученик отвечает по полям
    const parts = r.correct_answer?.parts
    const ans = parts
      ? { parts: Object.fromEntries(Object.entries(parts).map(([l, p]) => [l, String(p.value).split('|')[0]])) }
      : { text: typeof r.correct_answer === 'string' ? r.correct_answer.split('|')[0] : r.correct_answer }
    const bad = parts ? { parts: Object.fromEntries(Object.keys(parts).map(l => [l, '999'])) } : { text: '999' }
    const res = checkAnswer(ans, r.correct_answer, r.kgm, r.grading_config ?? {}, Number(r.max_score))
    const wrong = checkAnswer(bad, r.correct_answer, r.kgm, r.grading_config ?? {}, Number(r.max_score))
    if (!res.is_correct || wrong.is_correct) console.log(`  №${r.task_number}: checkAnswer(${JSON.stringify(ans)}) = ${res.is_correct}, «999» = ${wrong.is_correct}`)
  }

  // вложения: реальный размер и тип объекта в task-media
  const [media] = sql(`
    select tt.task_number, m.id, m.placement, m.storage_path,
           (o.metadata->>'size')::int size, o.metadata->>'mimetype' mime
    from task_media m join test_tasks tt on tt.id = m.task_id
    left join storage.objects o on o.bucket_id = 'task-media' and o.name = m.storage_path
    where tt.test_version_id = '${b.versionId}' order by tt.task_number, m.sort_order`)
  const bad = media.rows.filter(m => m.size == null || m.size < 400 || /html/.test(m.mime ?? ''))
  console.log(`  вложений ${media.rows.length}, битых ${bad.length}` + (bad.length ? ': ' + bad.map(m => `№${m.task_number} ${m.placement} ${m.size}б ${m.mime}`).join('; ') : ''))
  if (fix && bad.length) {
    sql(`delete from task_media where id in (${bad.map(m => `'${m.id}'`).join(',')})`)
    console.log('  битые вложения удалены')
  }
  const placements = media.rows.filter(m => !bad.includes(m)).map(m => `№${m.task_number}:${m.placement}`).join(' ')
  if (placements) console.log(`  целые: ${placements}`)
}
