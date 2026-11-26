// Сборка черновиков ДЗ по спецификации (формат — spec.example.mjs). Задания
// переносятся теми же функциями, что и кнопка «добавить в тест» на сайте
// (lib/tests/add-problem-to-version.ts), затем поля, ключи и решения правятся
// по спецификации. Повторный запуск дособирает черновик с места обрыва.
// Запуск из корня репозитория:
//   NODE_EXTRA_CA_CERTS=<pem> node .claude/skills/homework-agent-build/build.mjs <spec.mjs> [ключ теста...]
// Итог (id тестов и версий) пишется в built.json рядом со спецификацией.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const specPath = path.resolve(process.argv[2] ?? '')
if (!process.argv[2] || !fs.existsSync(specPath)) { console.error('укажите путь к spec.mjs'); process.exit(1) }
const { TESTS, PHOTO, PHOTO_TEXT, PHOTO_HINT } = await import(pathToFileURL(specPath).href)

const here = path.dirname(specPath)
const repo = process.cwd()
const require = createRequire(path.join(repo, 'package.json'))
const { createJiti } = require('jiti')
const { createClient } = require('@supabase/supabase-js')
const jiti = createJiti(path.join(repo, 'x.ts'), { alias: { '@': repo } })
const { addLibraryProblemToVersion, addBookProblemToVersion } = await jiti.import('@/lib/tests/add-problem-to-version')

const env = Object.fromEntries(fs.readFileSync(path.join(repo, '.env.local'), 'utf8').split('\n')
  .map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]))

// Крупные ответы с этой машины виснут. Проверке «не HTML-заглушка ли рисунок»
// (lib/tasks/media-in-prompt.ts) нужны первые 64 байта файла — просим только их.
function limitedFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input.url
  const headers = new Headers(init.headers)
  if ((init.method ?? 'GET').toUpperCase() === 'GET' && /\/storage\/v1\/object\/library-media\//.test(url)) headers.set('Range', 'bytes=0-63')
  return fetchRetry(input, { ...init, headers })
}
// Соединение с этой машины рвётся («fetch failed») — повторяем. Повтор вставки
// теоретически может задвоить строку, поэтому после сборки состав сверяется SQL.
async function fetchRetry(input, init, tries = 5) {
  for (let k = 1; ; k++) {
    try { return await fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) } catch (e) {
      if (k >= tries) throw e
      await new Promise(r => setTimeout(r, 1500 * k))
    }
  }
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: limitedFetch },
})
const must = (res, what) => { if (res.error) throw new Error(`${what}: ${res.error.message}`); return res.data }

function sql(text) {
  const r = spawnSync('node', ['scripts/supabase-query.mjs'], { cwd: repo, input: JSON.stringify({ sql: text }), encoding: 'utf8' })
  const out = JSON.parse(r.stdout)
  if (out.error) throw new Error(out.error)
  return out.results[0].rows
}

const plain = md => md.replace(/<[^>]+>/g, ' ').replace(/\$\$?/g, '').replace(/\*\*/g, '').replace(/\\,/g, ' ').replace(/\s+/g, ' ').trim()

const only = process.argv.slice(3)
const built = fs.existsSync(path.join(here, 'built.json')) ? JSON.parse(fs.readFileSync(path.join(here, 'built.json'), 'utf8')) : {}

for (const T of TESTS) {
  if (only.length && !only.includes(T.key)) continue

  // id в спецификации — префиксы; разворачиваем в полные и проверяем однозначность
  const libP = T.items.filter(i => i.lib).map(i => i.lib.replace(/-$/, ''))
  const bookP = T.items.filter(i => i.book).map(i => i.book)
  const byPrefix = (table, ps) => ps.length
    ? sql(`select id::text from ${table} where is_active and left(id::text,8) in (${ps.map(p => `'${p.slice(0, 8)}'`).join(',')})`)
    : []
  const libRows = byPrefix('library_problems', libP)
  const bookRows = byPrefix('book_problems', bookP)
  // у test_tasks нет is_active, поэтому задания тестов — полными id
  const taskRows = T.items.filter(i => i.task).map(i => ({ id: i.task }))
  const full = p => {
    const m = [...libRows, ...bookRows, ...taskRows].filter(r => r.id.startsWith(p))
    if (m.length !== 1) throw new Error(`${T.key}: префикс ${p} → ${m.length} совпадений`)
    return m[0].id
  }
  const ids = T.items.map(i => full((i.lib ?? i.book ?? i.task).replace(/-$/, '')))

  // уже начатый черновик (обрыв сети) — дособираем с первого отсутствующего номера
  const dup = must(await admin.from('tests').select('id, status').eq('created_by', T.teacherId).eq('title', T.title).is('deleted_at', null), 'проверка дубля')
  let test, version, done = new Set()
  if (dup.length) {
    if (dup.length > 1 || dup[0].status !== 'draft') { console.log(`${T.title}: уже есть`, JSON.stringify(dup)); continue }
    test = dup[0]
    version = must(await admin.from('test_versions').select('id').eq('test_id', test.id).single(), 'версия черновика')
    const have = must(await admin.from('test_tasks').select('id, task_number, task_answer_keys(id)').eq('test_version_id', version.id), 'задания черновика')
    // задание без ключа — вставка оборвалась посередине; удаляем и собираем заново.
    // task_id в task_answer_keys уникален, поэтому PostgREST отдаёт ключ объектом, не массивом
    const hasKey = t => Array.isArray(t.task_answer_keys) ? t.task_answer_keys.length > 0 : !!t.task_answer_keys
    for (const t of have.filter(t => !hasKey(t))) {
      for (const tbl of ['task_media', 'task_solutions']) must(await admin.from(tbl).delete().eq('task_id', t.id), `чистка ${tbl} №${t.task_number}`)
      must(await admin.from('test_tasks').delete().eq('id', t.id), `удаление неполного №${t.task_number}`)
      console.log(`удалено неполное задание №${t.task_number}`)
    }
    done = new Set(have.filter(hasKey).map(t => t.task_number))
    console.log(`\n== ${T.title}: продолжаю тест ${test.id}, уже есть №${[...done].sort((a, b) => a - b).join(',')}`)
  } else {
    test = must(await admin.from('tests').insert({
      organization_id: T.organizationId, title: T.title, subject: T.subject ?? 'Физика', grade: T.grade,
      kind: 'homework', status: 'draft', created_by: T.teacherId,
    }).select('id').single(), 'создание теста')
    version = must(await admin.from('test_versions').insert({ test_id: test.id, version_number: 1, status: 'draft' }).select('id').single(), 'создание версии')
    console.log(`\n== ${T.title}: тест ${test.id}, версия ${version.id}`)
  }

  for (const [i, it] of T.items.entries()) {
    const n = i + 1
    if (done.has(n)) continue
    const id = ids[i]
    if (it.lib) {
      const r = await addLibraryProblemToVersion(admin, {
        testVersionId: version.id, libraryProblemId: id, taskNumber: n, maxScore: 1, organizationId: T.organizationId,
      })
      if (!r.ok) throw new Error(`задание ${n} (${id}): ${r.error}`)
      if (it.key) {
        must(await admin.from('test_tasks').update({
          task_type: it.task_type, grading_method: it.grading_method, answer_format_hint: it.hint, options: [],
        }).eq('id', r.taskId), `правка задания ${n}`)
        must(await admin.from('task_answer_keys').delete().eq('task_id', r.taskId), `старый ключ ${n}`)
        must(await admin.from('task_answer_keys').insert({
          task_id: r.taskId, correct_answer: it.key, grading_method: it.key_method, grading_config: {},
        }), `ключ ${n}`)
      }
      console.log(`№${String(n).padStart(2)} lib  ${id.slice(0, 8)} → ${r.taskId.slice(0, 8)} рис:${r.hasImages ? 'да' : 'нет'}  ${it.note}`)
    } else if (it.task) {
      // задание другого теста (блок 1–5 пробника ОГЭ и т. п.): рисунки копируются
      // физически, чтобы удаление исходного теста не ломало ДЗ
      const src = must(await admin.from('test_tasks')
        .select('prompt_html, task_type, grading_method, answer_format_hint, options, answer_parts, library_problem_id, book_problem_id, task_answer_keys(correct_answer, grading_method, grading_config)')
        .eq('id', id).single(), `исходное задание ${n}`)
      const srcKey = Array.isArray(src.task_answer_keys) ? src.task_answer_keys[0] : src.task_answer_keys
      const md = it.md ?? src.prompt_html
      const task = must(await admin.from('test_tasks').insert({
        test_version_id: version.id, task_number: n, sort_order: n,
        prompt_html: md, prompt_text: plain(md),
        task_type: it.task_type ?? src.task_type, grading_method: it.grading_method ?? src.grading_method,
        answer_format_hint: it.hint ?? src.answer_format_hint, options: src.options ?? [], answer_parts: src.answer_parts ?? [],
        max_score: it.max ?? 1, has_images: false, review_status: 'approved',
        library_problem_id: src.library_problem_id, book_problem_id: src.book_problem_id,
      }).select('id').single(), `задание ${n}`)
      // it.media — задания, чьи рисунки приложить (общий план блока); по умолчанию свои
      const media = must(await admin.from('task_media').select('storage_path, media_type, placement, sort_order, alt_text')
        .in('task_id', it.media ?? [id]).order('sort_order'), `рисунки ${n}`)
      const copied = []
      for (const m of media) {
        const dest = `homework-copy/${task.id}/${m.storage_path.split('/').pop()}`
        const { error } = await admin.storage.from('task-media').copy(m.storage_path, dest)
        if (error) throw new Error(`копия рисунка ${m.storage_path}: ${error.message}`)
        copied.push({ task_id: task.id, storage_path: dest, media_type: m.media_type, placement: m.placement ?? 'above_text', sort_order: copied.length, alt_text: m.alt_text })
      }
      if (copied.length) {
        must(await admin.from('task_media').insert(copied), `рисунки ${n}`)
        must(await admin.from('test_tasks').update({ has_images: true }).eq('id', task.id), `has_images ${n}`)
      }
      if (it.solution) {
        const solMd = it.solution.join('\n\n')
        must(await admin.from('task_solutions').insert({
          task_id: task.id, solution_html: solMd, solution_text: plain(solMd), has_images: false, access_policy: 'by_request',
        }), `решение ${n}`)
      }
      // ключ — последним: по нему повторный запуск считает задание собранным
      must(await admin.from('task_answer_keys').insert({
        task_id: task.id, correct_answer: it.key ?? srcKey.correct_answer,
        grading_method: it.key_method ?? srcKey.grading_method, grading_config: srcKey?.grading_config ?? {},
      }), `ключ ${n}`)
      console.log(`№${String(n).padStart(2)} test ${id.slice(0, 8)} → ${task.id.slice(0, 8)} рис:${copied.length}  ${it.note}`)
    } else {
      const max = it.max ?? 1
      const r = await addBookProblemToVersion(admin, { testVersionId: version.id, bookProblemId: id, taskNumber: n, maxScore: max })
      if (!r.ok) throw new Error(`задание ${n} (${id}): ${r.error}`)
      // task_type задан — автопроверка (numeric или composite с parts), иначе
      // ручная проверка с обязательным фото решения
      const auto = !!it.task_type
      must(await admin.from('test_tasks').update({
        prompt_html: auto ? it.md : it.md + PHOTO,
        prompt_text: auto ? plain(it.md) : `${plain(it.md)} ${PHOTO_TEXT}`,
        task_type: auto ? it.task_type : 'manual_review',
        grading_method: auto ? it.grading_method : 'manual',
        answer_format_hint: auto ? (it.hint ?? null) : PHOTO_HINT,
        answer_parts: it.parts ?? [], options: [], has_images: false, max_score: max,
      }).eq('id', r.taskId), `правка задания ${n}`)
      must(await admin.from('task_answer_keys').delete().eq('task_id', r.taskId), `старый ключ ${n}`)
      must(await admin.from('task_answer_keys').insert({
        task_id: r.taskId, correct_answer: it.key, grading_method: auto ? it.key_method : 'manual', grading_config: {},
      }), `ключ ${n}`)
      if (it.solution) {
        const solMd = it.solution.join('\n\n')
        must(await admin.from('task_solutions').insert({
          task_id: r.taskId, solution_html: solMd, solution_text: plain(solMd), has_images: false, access_policy: 'by_request',
        }), `решение ${n}`)
      }
      console.log(`№${String(n).padStart(2)} book ${id.slice(0, 8)} → ${r.taskId.slice(0, 8)} ${max} б., ${auto ? 'авто' : 'ручная'}  ${it.note}`)
    }
  }
  built[T.key] = { testId: test.id, versionId: version.id, title: T.title }
  fs.writeFileSync(path.join(here, 'built.json'), JSON.stringify(built, null, 2))
}
