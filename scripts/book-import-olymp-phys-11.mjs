#!/usr/bin/env node
// Отдельный импортёр ТОЛЬКО для задачника «Олимпиадная физика. 11 класс»
// (И. В. Яковлев, MathUs.ru, выпуск 11.2023) — PaddleOCR-VL JSON страниц.
// Общий scripts/book-import.mjs не подходит: ответ здесь стоит СРАЗУ под
// задачей (короткая строка у правого края колонки), а не в разделе «Ответы»,
// и картинок в markdown нет вовсе (markdown.images пуст) — рисунки вырезаются
// из изображения страницы (inputImage) по рамке блока.
//
// Что делает:
//  1. Склеивает блоки всех страниц в один поток, выкидывает колонтитулы и
//     номера страниц. Разрезает текстовые блоки, в которые OCR слепил две
//     задачи подряд (39 случаев: «…\n\n1.15.12. (…) …»).
//  2. Структура — по заголовкам в тексте: «Глава N» + название → глава,
//     «### N.M Название» → параграф. Задачи — «N.M.K.» в начале блока, номер
//     сверяется с текущим параграфом (LIS по K отсекает случайные совпадения).
//  3. Ответ задачи — блоки ПОСЛЕ последнего абзаца условия, начинающиеся не у
//     левого поля (x ≥ 300 из 1191): в оригинале ответ выровнен вправо по
//     колонке текста (колонка уже, если справа стоит рисунок). Рамку ответа
//     (\boxed, \left|…\right|, array{r}) снимаем, полноширинную пунктуацию OCR
//     и кружки «①…⑨» (ответ в задачах с вариантами) нормализуем. Маленькая
//     картинка там же — ответ, распознанный как рисунок: показываем её
//     в строке «Ответ:», в correct_answer пишем пометку.
//  4. Рисунки и графики (chart) вырезаются по рамке из страницы, заливаются
//     в Storage (bucket book-media) и привязываются к задаче по ВЕРТИКАЛИ на
//     странице (OCR иногда перечисляет плавающий рисунок после следующей
//     задачи). Глифы меньше 70×70 px — декор, выкидываются (см. AGENTS.md).
//  5. Пишет книгу (book_type 'olympiad', «Физика», 10-11 класс), главы,
//     параграфы, страницы и задачи. Markdown страницы собирается заново:
//     условие задачи — непрерывный фрагмент (md_start/md_end) на странице
//     заголовка, даже если в книге оно переходит на следующую; без --answers под
//     ним строка «**Ответ:** …» из OCR (только для сверки). Ссылки
//     «Дополнительные задачи — в листке …» (листки MathUs, гиперссылок в OCR
//     нет) не переносятся.
//
// Ответы в книге напечатаны ВВЕРХ НОГАМИ — OCR читает их с ошибками в цифрах
// (9↔6, пропуски строк), поэтому источник истины — сверенный глазами по
// вырезкам файл --answers (TSV «номер<TAB>ответ markdown»). С ним OCR-блоки
// ответов в страницу не выводятся, ответ попадает только в correct_answer, а
// задача без строки в файле получает answer_source 'none' (качественные,
// на доказательство, на построение графика).
//
// Использование:
//   node scripts/book-import-olymp-phys-11.mjs <olymp_phys.json> --dry-run [--report <dir>] [--answers <tsv>]
//   node scripts/book-import-olymp-phys-11.mjs <olymp_phys.json> --answers <tsv> --pages <dir>   # запись в БД
// --pages — кэш изображений страниц p000.jpg… (нет файла — скачивается из inputImage).
// Для записи в БД нужны SUPABASE_URL (или NEXT_PUBLIC_SUPABASE_URL) и
// SUPABASE_SERVICE_ROLE_KEY (env или .env.import.local/.env.local).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const args = process.argv.slice(2)
const file = args.find((a, i) => !a.startsWith('--') && !['--report', '--pages', '--answers'].includes(args[i - 1]))
if (!file) {
  console.error('Usage: node scripts/book-import-olymp-phys-11.mjs <file.json> [--dry-run] [--report <dir>] [--pages <dir>] [--answers <tsv>]')
  process.exit(1)
}
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const dryRun = args.includes('--dry-run')
const reportDir = opt('--report')
const pagesDir = opt('--pages') ?? path.join(os.tmpdir(), 'olymp-phys-11-pages')
const answersFile = opt('--answers')
if (!dryRun && !answersFile) { console.error('Запись в БД — только со сверенными ответами (--answers <tsv>)'); process.exit(1) }

const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
if (!Array.isArray(raw)) { console.error('Ожидался массив страниц PaddleOCR'); process.exit(1) }

// Сверенные ответы: «номер<TAB>ответ»
const verified = answersFile ? new Map() : null
if (answersFile) {
  for (const line of fs.readFileSync(answersFile, 'utf-8').split(/\r?\n/)) {
    const tab = line.indexOf('\t')
    if (tab > 0 && line.slice(tab + 1).trim()) verified.set(line.slice(0, tab).trim(), line.slice(tab + 1).trim())
  }
}

const PAGE_W = 1191          // ширина изображения страницы, px (рамки блоков — в тех же координатах)
// блок, начинающийся левее, — текст условия (абзацы с x≈80, пункты с x≈110);
// правее — ответ (широкая рамка ответа начинается с x≈290, как у 1.15.8) или формула
const LEFT_MARGIN_MAX = 200
const BOTTOM_FOOTER_Y = 1560 // ниже — колонтитул «☐ N» и номер страницы
const DECORATIVE_PX = 70
const CONTENT_FROM = 4       // 0 — титул и предисловие, 1–3 — оглавление
// footer/footer_image в этой книге — рамки ответов у низа страницы, не колонтитулы
const SERVICE = new Set(['header', 'number', 'header_image'])
const TASK_RE = /^(\d)\.(\d{1,2})\.(\d{1,2}|[bб])\.\s*/
const taskNo = (s) => (/^[bб]$/.test(s) ? 6 : +s) // OCR читает «6» как «b»: 2.14.b.
const SECTION_RE = /^#*\s*(\d)\.(\d{1,2})\s+(\S.*)$/
const CHAPTER_RE = /^#*\s*Глава\s+(\d)\s*$/
// ссылка на листок MathUs — в OCR без гиперссылки, не переносим. Не \b: в JS
// граница слова есть только у латиницы, после «задачи» она не срабатывает
const EXTRA_RE = /^Дополнительные задачи(?![а-яё])/
// опечатки OCR в названиях параграфов (и в оглавлении, и в заголовке на странице)
const SECTION_TITLE_FIXES = {
  'Система двух лин3': 'Система двух линз',
  'Самониндукция': 'Самоиндукция',
  'Основное уравнение MKT идеального газа': 'Основное уравнение МКТ идеального газа',
}

// ── Нормализация текста ──────────────────────────────────────────────────────
const FULLWIDTH = { '（': '(', '）': ')', '；': ';', '，': ',', '：': ':', '．': '.', '！': '!', '？': '?' }
const fixFullwidth = (s) => s.replace(/[（）；，：．！？]/g, (c) => FULLWIDTH[c])

// Названия олимпиад в скобках у номера задачи: OCR их калечит по-разному
const OLYMPIAD_FIXES = [
  [/\(\s*В[еc][еcс]?[иеcс]?[бцс]\.?,/g, '(Всесиб.,'],
  [/\(\s*В[а-я]{2,4}иб\.,/g, '(Всесиб.,'],
  [/«Pocatom»|«Росатoм»|«Pосатом»|«Госатом»/g, '«Росатом»'],
  [/«Курчато[^»]{0,3}»|«Kурчатов»/g, '«Курчатов»'],
  [/«Шаг\s*[өб6вeеє]?\s*буд[уы]+[уц]*(?:щ|ц)?ее»/g, '«Шаг в будущее»'],
  [/Оли[а-я]{3,6} КФУ/g, 'Олимпиада КФУ'],
  [/Инженерная оли[а-я]{3,6}\b/g, 'Инженерная олимпиада'],
  [/«Буд[^»\s]* исследователи — будущее науки»/g, '«Будущие исследователи — будущее науки»'],
  [/«[^»]{0,12}энергетики»/g, '«Надежда энергетики»'],
  [/«[^»]{0,4}кори Вор[а-яъь]+ы гор[^»]*»/g, '«Покори Воробьёвы горы!»'],
  [/«[ЧФ]ормула Единства»\s*\/\s*«[1Т]ретье тысячелетие»/g, '«Формула Единства» / «Третье тысячелетие»'],
]
function fixOlympiad(s) {
  let out = s
  for (const [re, to] of OLYMPIAD_FIXES) out = out.replace(re, to)
  return out
}

// Искажения OCR в тексте условий, сверенные по изображению страницы
const TEXT_FIXES = [
  ['ZUZ3, 11) 1ело оросили', '2023, 11) Тело бросили'],                       // 1.5.12
  ['через whichывается вода', 'через которые с высокой скоростью выбрасывается вода'], // 1.16.7
  ['равновesие', 'равновесие'],                                                  // 1.29.6
  ['ЭДС в и внутренним сопротивлением г,', 'ЭДС $\\mathcal{E}$ и внутренним сопротивлением $r$,'], // 3.28.4
  ['Учалиеся', 'Учащиеся'],                                                      // 3.29.2
  ['являения', 'явления'],
  ['теплоноситель,ауторуй', 'теплоноситель, который'],                           // 2.15.4
  ['термодерного', 'термоядерного'],                                             // 3.25.1
  ['лаборатори физики', 'лаборатории физики'],                                   // 3.25.1
  ['1-  $ \\alpha $, 2-  $ \\alpha $', '1 — да, 2 — да'],                         // 3.3.1: «да» прочитано как α
  ['1-da, 2-нет', '1 — да, 2 — нет'],
  // кириллица в формулах, прочитанная латиницей
  ['\\mathrm{ec}\\mathrm{J}\\mathrm{H}', '\\text{если }'],                       // 1.10.3
  ['\\mathrm{J}_{', '\\text{Л}_{'],                                              // 4.9.1: линзы Л₁, Л₂
  ['\\text{H} \\cdot \\text{m}^2', '\\text{Н} \\cdot \\text{м}^2'],              // 3.3.4
  ['\\text{H} \\cdot \\text{м}^2', '\\text{Н} \\cdot \\text{м}^2'],              // 3.8.3
  ['\\rho_{\\mathrm{B}}', '\\rho_{\\text{в}}'],                                  // 1.30.3
  ['\\rho_{\\mathrm{M}}', '\\rho_{\\text{м}}'],
  ['\\rho_{\\mathrm{L}}', '\\rho_{\\text{л}}'],
  ['M_{\\mathrm{B}}', 'M_{\\text{в}}'],                                          // 2.16.1
  ['M_{\\mathrm{II}}', 'M_{\\text{п}}'],
  ['\\mathrm{tp}', '\\text{тр}'],                                                // 1.36.2
  ['\\text{m/s}', '\\text{м/с}'],                                                // 1.37.6
  ['\\mathrm{m}^{3} \\cdot \\mathrm{Па}', '\\text{м}^{3} \\cdot \\text{Па}'],    // 2.15.7
  ['\\text{M/c}^2', '\\text{м/с}^2'],                                            // 4.2.6
  ['\\mathrm{пилот+ранец+шланг}\\mathrm{с}\\mathrm{водой}', '\\text{пилот + ранец + шланг с водой}'], // 1.16.7
  ['F_{\\mathrm{c o n p}}', 'F_{\\text{сопр}}'],                                 // 1.36.4, 1.36.5
  ['\\rho_{\\mathrm{b}}', '\\rho_{\\text{в}}'],
  ['5,67\\cdot10^{8}\\mathrm{\\frac{B r}{m^{2}K^{4}}}', '5{,}67\\cdot10^{-8}\\,\\frac{\\text{Вт}}{\\text{м}^{2}\\cdot\\text{К}^{4}}'], // 4.1.4
]
// Буквы вариантов ответа OCR читает латиницей и греческим («A) B) B) Γ)» вместо
// «А) Б) В) Г)»): если варианты начинаются с А/A, k-й вариант получает k-ю букву
// русского алфавита — по одной лишь форме «B» не отличить Б от В
const OPTION_RE = /(^|\n)(\s*)([A-Za-zА-ЯΑ-Ω])\)/g
function fixOptionLabels(md) {
  const labels = [...md.matchAll(OPTION_RE)].map((m) => m[3])
  if (!labels.length || !/^[AА]$/.test(labels[0]) || labels.length > 6 || !labels.some((l) => /[A-Za-zΑ-Ω]/.test(l))) return md
  let k = 0
  return md.replace(OPTION_RE, (_, pre, sp) => `${pre}${sp}${'АБВГДЕ'[k++]})`)
}
// Строки абзаца OCR иногда разделены пустой строкой (\n\n) — в markdown это
// разрыв абзаца посреди фразы и висящий перенос «ради-↵↵уса»: склеиваем
function joinBrokenLines(s) {
  return s
    .replace(/([а-яё])-\n+([а-яё])/g, '$1$2')
    .replace(/([^\n.!?:;])\n\n(?=[а-яё])/g, '$1 ')
}

// Ответ, попавший в условие: рамка во всю колонку (x1 < LEFT_MARGIN_MAX) или
// чужой ответ, который OCR поставил после заголовка следующей задачи
const ANSWER_IN_CONDITION = [
  ['3.3.8', /\\mathrm\{p r\}u Q q>0/],
  ['4.2.2', /^1\) 3; 2\) 64; 3\) 24; 4\) 2; 5\) 7$/], // ответ 4.2.1
]

const CIRCLED = { '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5', '⑥': '6', '⑦': '7', '⑧': '8', '⑨': '9' }

// Рамка и обёртки OCR вокруг ответа
function unwrapAnswerMath(m) {
  let s = m.trim()
  for (let k = 0; k < 4; k++) {
    const before = s
    s = s.replace(/^\\begin\{array\}\{[lcr]+\}\s*\{([\s\S]*)\}\s*\\end\{array\}$/, '$1').trim()
    s = s.replace(/^\\boxed\{([\s\S]*)\}$/, '$1').trim()
    s = s.replace(/^\\left\s*\|\s*([\s\S]*?)\s*\\right\s*[|.]$/, '$1').trim()
    s = s.replace(/^\\left\s*\|\s*([\s\S]*)$/, '$1').trim()
    s = s.replace(/^\\left\(\s*([\s\S]*?)\s*\\right\)$/, '$1').trim()
    s = s.replace(/^\\begin\{pmatrix\}([\s\S]*)\\end\{pmatrix\}$/, '$1').trim()
    if (s === before) break
  }
  return s
}

// Текст ответа → markdown одной строкой: формулы $…$, без рамок
function cleanAnswer(text) {
  let s = fixFullwidth(text.trim())
  if (/^[①-⑨]$/.test(s)) return CIRCLED[s]
  s = s.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_, m) => `$${unwrapAnswerMath(m)}$`)
  s = s.replace(/\$\s*([^$]+?)\s*\$/g, (_, m) => `$${unwrapAnswerMath(m)}$`)
  return s.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

// Числовой ответ без формул и единиц — можно проверять автоматически
const isPlainNumber = (s) => /^-?\d+(?:[.,]\d+)?$/.test(s.replace(/\s/g, ''))

// Рамка рисунка, в которую OCR захватил перевёрнутую рамку ответа (иначе ответ
// оказался бы в условии): «страница:x1,y1,x2,y2» → обрезанная рамка
const FIGURE_BBOX_FIX = {
  '11:262,1346,1102,1568': [262, 1346, 1102, 1522], // 1.5.16
  '12:865,1109,1112,1297': [865, 1160, 1112, 1297], // 1.6.3: сверху рамка «0,4 оборота»
  '30:790,532,1113,769': [790, 600, 1113, 769],     // 1.19.2: сверху рамка «3»
  '46:327,833,1103,1038': [327, 833, 880, 970],     // 1.33.2: снизу справа рамка ответа
  '66:394,381,1110,616': [394, 381, 805, 565],      // 2.6.7: снизу рамка ответа
  '108:140,836,1099,1082': [140, 836, 1099, 1000],  // 3.14.14: снизу рамка ответа
  '122:320,102,1111,422': [320, 102, 1111, 345],    // 3.24.1: снизу рамка ответа
  '149:368,332,1108,626': [368, 332, 1108, 560],    // 4.14.2: снизу рамка ответа
}
// Одна рамка OCR на несколько рисунков разных задач (между ними — рамка ответа)
const FIGURE_SPLIT = {
  '24:810,391,1111,878': [[810, 391, 1111, 700], [810, 705, 1111, 878]],     // 1.15.20 | 1.15.21
  '42:981,686,1110,1201': [[981, 686, 1110, 912], [1008, 868, 1110, 1201]],  // 1.29.8 | 1.29.9
  '100:884,722,1114,1513': [[884, 722, 1114, 920], [884, 1175, 1114, 1420]], // 3.11.1 | 3.12.1
}
// Закрасить белым чужой фрагмент внутри вырезки: рисунки 1.29.8 и 1.29.9 заходят друг на друга
const FIGURE_MASKS = {
  '42:981,686,1110,912': [[1011, 866, 1114, 916]],
}

// Заголовок задачи, который OCR исказил до неузнаваемости: без правки задача
// вклеивается в условие предыдущей (1.37.7 сидела внутри 1.37.6)
const HEADER_FIXES = [
  ['1.31.1. («Ψυστμεχ», ZUZS, 11) Автомоуль массон', '1.37.7. («Физтех», 2023, 11) Автомобиль массой'],
]

// ── 1. Поток блоков ──────────────────────────────────────────────────────────
const flow = []
raw.forEach((p, pi) => {
  for (const b of p.prunedResult?.parsing_res_list ?? []) {
    const label = b.block_label
    // figure_title/text иногда обёрнуты в <div> — задачи 2.12.14, 3.17.6 размечены как подпись рисунка
    let c = (b.block_content ?? '').replace(/<\/?div[^>]*>/g, '').trim()
    for (const [from, to] of HEADER_FIXES) c = c.replace(from, to)
    // number посреди страницы — однозначный ответ в рамке, не номер страницы
    if (SERVICE.has(label) && !(label === 'number' && b.block_bbox[1] < BOTTOM_FOOTER_Y)) continue
    // две задачи в одном блоке — режем по заголовку второй
    const parts = label === 'text' ? c.split(/\n\n(?=\d\.\d{1,2}\.\d{1,2}\.\s)/) : [c]
    // у частей разрезанного блока своей рамки нет — делим высоту пропорционально
    // длине текста, иначе «заголовок» второй задачи оказывается выше реального
    // и привязка по вертикали отдаёт ему ответ предыдущей (1.15.11 → 1.15.12)
    const fixKey = `${pi}:${b.block_bbox.join(',')}`
    if (FIGURE_BBOX_FIX[fixKey]) { flow.push({ pi, label, bbox: FIGURE_BBOX_FIX[fixKey], c, split: false }); continue }
    if (FIGURE_SPLIT[fixKey]) { for (const bbox of FIGURE_SPLIT[fixKey]) flow.push({ pi, label, bbox, c, split: false }); continue }
    const [x1, y1, x2, y2] = b.block_bbox
    let acc = 0
    parts.forEach((part, k) => {
      const from = acc / c.length, to = (acc + part.length) / c.length
      acc += part.length + 2
      const bbox = parts.length > 1 ? [x1, Math.round(y1 + (y2 - y1) * from), x2, Math.round(y1 + (y2 - y1) * to)] : b.block_bbox
      flow.push({ pi, label, bbox, c: part.trim(), split: k > 0 })
    })
  }
})

// ── 2. Структура и задачи ────────────────────────────────────────────────────
const chapters = []   // { num, title, pageStart }
const sections = []   // { num: '1.1', title, chapterIdx, pageStart, intro: [] }
const tasks = []      // { id, sec, n, headerIdx, pi, blocks: [] }
let curChapter = null, curSection = null, curTask = null, pendingChapter = null
const owners = new Array(flow.length).fill(null)
const renumbered = []

for (let i = 0; i < flow.length; i++) {
  const b = flow[i]
  if (b.pi < CONTENT_FROM) continue
  const isHeading = b.label === 'paragraph_title' || b.label === 'doc_title'
  if (isHeading) {
    const ch = b.c.match(CHAPTER_RE)
    if (ch) { pendingChapter = { num: +ch[1], title: null, pageStart: b.pi }; continue }
    if (pendingChapter && !pendingChapter.title) {
      pendingChapter.title = b.c.replace(/^#+\s*/, '').trim()
      chapters.push(pendingChapter); curChapter = chapters.length - 1; pendingChapter = null
      continue
    }
    const sm = b.c.match(SECTION_RE)
    if (sm && !TASK_RE.test(b.c.replace(/^#+\s*/, ''))) {
      const title = sm[3].trim()
      sections.push({ num: `${sm[1]}.${sm[2]}`, title: SECTION_TITLE_FIXES[title] ?? title, chapterIdx: curChapter, pageStart: b.pi, headIdx: i })
      curSection = sections.length - 1; curTask = null
      continue
    }
  }
  const tm = b.c.match(TASK_RE)
  if (tm && ['text', 'paragraph_title', 'content', 'vision_footnote', 'figure_title'].includes(b.label) && curSection !== null) {
    let sec = `${tm[1]}.${tm[2]}`
    const n = taskNo(tm[3])
    const cur = sections[curSection].num
    const lastN = curTask !== null && tasks[curTask].sectionIdx === curSection ? tasks[curTask].n : 0
    // OCR перепутал цифру параграфа («1.3.12.» внутри § 1.5), а номер идёт следующим по счёту
    if (sec !== cur && tm[1] === cur.split('.')[0] && n === lastN + 1) { renumbered.push(`${sec}.${n} → ${cur}.${n}`); sec = cur }
    if (sec === cur) {
      tasks.push({ id: `${sec}.${n}`, sec, n, sectionIdx: curSection, headerIdx: i, pi: b.pi, blocks: [] })
      curTask = tasks.length - 1
      owners[i] = { task: curTask, role: 'header' }
      continue
    }
  }
  owners[i] = curTask !== null ? { task: curTask } : (curSection !== null ? { section: curSection } : null)
}

// LIS по номеру внутри параграфа: случайное «1.3.12.» в тексте не рвёт нумерацию
function lis(nums) {
  const tails = [], prev = new Array(nums.length).fill(-1), tailIdx = []
  nums.forEach((n, i) => {
    let lo = 0, hi = tails.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < n) lo = mid + 1; else hi = mid }
    tails[lo] = n; tailIdx[lo] = i; prev[i] = lo > 0 ? tailIdx[lo - 1] : -1
  })
  const keep = new Set()
  for (let i = tailIdx[tails.length - 1]; i >= 0; i = prev[i]) keep.add(i)
  return keep
}
const dropped = []
for (let s = 0; s < sections.length; s++) {
  const own = tasks.map((t, i) => ({ t, i })).filter((x) => x.t.sectionIdx === s)
  if (!own.length) continue
  const keep = lis(own.map((x) => x.t.n))
  own.forEach((x, k) => { if (!keep.has(k)) { x.t.dropped = true; dropped.push(x.t.id) } })
}
// выкинутый LIS «заголовок» — обычный текст предыдущей задачи
for (let i = 0; i < flow.length; i++) {
  const o = owners[i]
  if (o?.role === 'header' && tasks[o.task].dropped) {
    let prevTask = null
    for (let t = o.task - 1; t >= 0; t--) if (!tasks[t].dropped) { prevTask = t; break }
    owners[i] = prevTask !== null ? { task: prevTask } : null
  }
}
const liveTasks = tasks.filter((t) => !t.dropped)

// Рисунки и рамки ответов (блоки не у левого поля) — к задаче по вертикали на
// своей странице: OCR перечисляет их иногда уже после заголовка следующей задачи
// (ответ 1.6.2 стоял в потоке после 1.6.3)
for (let i = 0; i < flow.length; i++) {
  const b = flow[i]
  const floating = ['image', 'chart', 'footer_image'].includes(b.label) || (b.bbox[0] >= LEFT_MARGIN_MAX && !owners[i]?.role)
  if (!floating || !owners[i]) continue
  const cy = (b.bbox[1] + b.bbox[3]) / 2
  const onPage = liveTasks.filter((t) => t.pi === b.pi && flow[t.headerIdx].bbox[1] <= cy)
  const secOnPage = sections.filter((s) => s.pageStart === b.pi && flow[s.headIdx].bbox[1] <= cy)
  const lastTask = onPage.length ? onPage[onPage.length - 1] : null
  const lastSec = secOnPage.length ? secOnPage[secOnPage.length - 1] : null
  if (lastTask && (!lastSec || flow[lastTask.headerIdx].bbox[1] > flow[lastSec.headIdx].bbox[1])) owners[i] = { task: tasks.indexOf(lastTask) }
}
// Рисунок, который по вертикали ближе к чужому заголовку: «страница:рамка» → задача
const FIGURE_OWNER = {
  '123:883,577,1106,699': '3.26.3', // поля E и B — у 3.26.3, а не у 3.26.5
  '100:884,722,1114,920': '3.11.1',  // шар в полости — из общей рамки с рисунком 3.12.1
  '100:884,1175,1114,1420': '3.12.1',
  '24:810,391,1111,700': '1.15.20',
  '24:810,705,1111,878': '1.15.21',
  '42:981,686,1110,912': '1.29.8',
  '42:1008,868,1110,1201': '1.29.9',
}
for (let i = 0; i < flow.length; i++) {
  const id = FIGURE_OWNER[`${flow[i].pi}:${flow[i].bbox.join(',')}`]
  if (id) owners[i] = { task: tasks.findIndex((t) => t.id === id && !t.dropped) }
}
for (let i = 0; i < flow.length; i++) if (owners[i]?.task !== undefined && owners[i].role !== 'header') tasks[owners[i].task].blocks.push(i)

// ── 3. Условие и ответ ───────────────────────────────────────────────────────
// Мелкий глиф у правого края — не декор, а однозначный ответ в рамке («3», «Б»)
const isDecorative = (b) => (b.bbox[2] - b.bbox[0]) < DECORATIVE_PX && (b.bbox[3] - b.bbox[1]) < DECORATIVE_PX && b.bbox[0] < 500
const isFigure = (b) => b.label === 'image' || b.label === 'chart' || b.label === 'footer_image'
const isLeftText = (b) => !isFigure(b) && b.bbox[0] < LEFT_MARGIN_MAX && b.c !== '' && !b.split
for (const t of liveTasks) {
  const blocks = t.blocks.map((i) => ({ i, b: flow[i] }))
  // последний блок условия у левого поля (заголовок — всегда условие)
  let lastLeft = -1
  blocks.forEach((x, k) => { if (isLeftText(x.b)) lastLeft = k })
  t.condition = [t.headerIdx]
  t.answer = []
  t.answerImages = []
  blocks.forEach((x, k) => {
    const b = x.b
    if (EXTRA_RE.test(b.c)) return
    if (isFigure(b)) {
      if (isDecorative(b)) return
      // мелкая картинка у правого края — всегда рамка ответа, даже если OCR
      // поставил её перед абзацем следующей задачи (ответ 2.3.5 в 2.3.6)
      const small = (b.bbox[3] - b.bbox[1]) <= 75 && (b.bbox[2] - b.bbox[0]) <= 320 && b.bbox[0] >= 500
      if (small && b.label !== 'chart') t.answerImages.push(x.i)
      else t.condition.push(x.i)
      return
    }
    if (b.c === '') return
    if (k > lastLeft && b.bbox[0] >= LEFT_MARGIN_MAX) t.answer.push(x.i)
    else t.condition.push(x.i)
  })
  // центрированная формула условия перед настоящим ответом: оставляем в условии
  if (t.answer.length > 1) {
    const centered = (b) => Math.abs((b.bbox[0] + b.bbox[2]) / 2 - PAGE_W / 2) < 90 && b.bbox[2] < 1040
    const keep = t.answer.filter((i, k) => !(k < t.answer.length - 1 && centered(flow[i])))
    t.condition.push(...t.answer.filter((i) => !keep.includes(i)))
    t.answer = keep
  }
  for (const [id, re] of ANSWER_IN_CONDITION) {
    if (id !== t.id) continue
    const moved = t.condition.filter((i) => re.test(flow[i].c))
    t.condition = t.condition.filter((i) => !moved.includes(i))
    t.answer.push(...moved)
  }
  t.condition.sort((a, b) => a - b)
  t.answerText = t.answer.map((i) => cleanAnswer(flow[i].c)).filter(Boolean).join('; ')
}

// Рамка ответа на странице (ответ в книге напечатан вверх ногами — для сверки
// глазами по вырезке): блоки ответа, а если OCR рамку не увидел — полоса справа
// под последним блоком задачи до следующего заголовка.
for (const [k, t] of liveTasks.entries()) {
  const own = [...t.answer, ...t.answerImages]
  if (own.length) {
    const byPage = new Map()
    for (const i of own) { const b = flow[i]; const r = byPage.get(b.pi); byPage.set(b.pi, r ? [Math.min(r[0], b.bbox[0]), Math.min(r[1], b.bbox[1]), Math.max(r[2], b.bbox[2]), Math.max(r[3], b.bbox[3])] : [...b.bbox]) }
    t.answerRegions = [...byPage].map(([pi, r]) => ({ pi, box: [r[0] - 6, r[1] - 6, r[2] + 6, r[3] + 6] }))
    continue
  }
  const all = [t.headerIdx, ...t.blocks].map((i) => flow[i])
  const last = all.reduce((a, b) => (b.pi > a.pi || (b.pi === a.pi && b.bbox[3] > a.bbox[3]) ? b : a))
  const next = liveTasks[k + 1]
  const nextHead = [next ? flow[next.headerIdx] : null, ...sections.map((s) => flow[s.headIdx])]
    .filter((b) => b && b.pi === last.pi && b.bbox[1] > last.bbox[3] - 2)
    .reduce((a, b) => (!a || b.bbox[1] < a.bbox[1] ? b : a), null)
  const bottom = Math.min(nextHead ? nextHead.bbox[1] : BOTTOM_FOOTER_Y, last.bbox[3] + 150)
  t.answerRegions = [{ pi: last.pi, box: [430, last.bbox[3] - 4, 1125, Math.max(bottom, last.bbox[3] + 30)] }]
  if (!nextHead && BOTTOM_FOOTER_Y - last.bbox[3] < 45 && last.pi + 1 < raw.length) t.answerRegions.push({ pi: last.pi + 1, box: [430, 100, 1125, 230] })
}

// ── 4. Markdown блоков и страниц ─────────────────────────────────────────────
const crops = new Map() // ключ кадра → { pi, bbox, storagePath, url }
let SUPABASE_PUBLIC = 'https://example.invalid'
const bookId = randomUUID()
function figureMd(b) {
  const key = `${b.pi}_${b.bbox.join('_')}`
  if (!crops.has(key)) {
    const storagePath = `${bookId}/p${String(b.pi).padStart(3, '0')}_${b.bbox.join('_')}.jpg`
    crops.set(key, { pi: b.pi, bbox: b.bbox, storagePath })
  }
  const c = crops.get(key)
  const url = `${SUPABASE_PUBLIC}/storage/v1/object/public/book-media/${c.storagePath}`
  const width = Math.max(8, Math.min(100, Math.round(((b.bbox[2] - b.bbox[0]) / PAGE_W) * 100)))
  return `<div style="text-align: center;"><img src="${url}" alt="Рисунок" width="${width}%" /></div>`
}
function blockMd(i) {
  const b = flow[i]
  if (isFigure(b)) return figureMd(b)
  let s = fixFullwidth(b.c)
  if (owners[i]?.role === 'header' || TASK_RE.test(s)) s = fixOlympiad(s)
  if (b.label === 'paragraph_title' || b.label === 'doc_title') s = s.replace(/^#+\s*/, '')
  // номер в заголовке — как у задачи после исправлений («1.3.12.» → «1.5.12.», «2.14.b.» → «2.14.6.»)
  if (owners[i]?.role === 'header') s = s.replace(/^#*\s*/, '').replace(TASK_RE, `${tasks[owners[i].task].id}. `)
  for (const [from, to] of TEXT_FIXES) s = s.replaceAll(from, to)
  return joinBrokenLines(s)
}

const pagesMd = raw.map(() => [])     // строки markdown по страницам
const problemAnchors = new Map()      // task → { pi, start, end }
const append = (pi, md) => {
  const parts = pagesMd[pi]
  const offset = parts.reduce((s, x) => s + x.length + 2, 0)
  parts.push(md)
  return { start: offset, end: offset + md.length }
}

// титул и оглавление — как есть, без картинок
for (let pi = 0; pi < CONTENT_FROM; pi++) {
  for (const b of flow.filter((x) => x.pi === pi)) {
    if (isFigure(b) || !b.c) continue
    let s = b.c
    for (const [from, to] of Object.entries(SECTION_TITLE_FIXES)) s = s.replaceAll(from, to)
    append(pi, s)
  }
}
// порядок вывода: каждый блок в позиции первого появления своего «владельца»
const emitted = new Set()
const chapterHeadPages = new Map(chapters.map((c) => [c.pageStart, c]))
let inExtraList = false // идут названия листков после «Дополнительные задачи — в листках:»
for (let i = 0; i < flow.length; i++) {
  const b = flow[i]
  if (b.pi < CONTENT_FROM || emitted.has(i)) continue
  const o = owners[i]
  // список листков обрывается на первой задаче или заголовке
  if (o?.section === undefined || sections.some((s) => s.headIdx === i)) inExtraList = false
  if (chapterHeadPages.has(b.pi) && CHAPTER_RE.test(b.c)) {
    const c = chapterHeadPages.get(b.pi)
    append(b.pi, `## Глава ${c.num}. ${c.title}`)
    emitted.add(i)
    continue
  }
  if (chapters.some((c) => c.title && b.c.replace(/^#+\s*/, '').trim() === c.title && c.pageStart === b.pi)) { emitted.add(i); continue }
  const sIdx = sections.findIndex((s) => s.headIdx === i)
  if (sIdx >= 0) { append(b.pi, `### ${sections[sIdx].num} ${sections[sIdx].title}`); emitted.add(i); continue }
  if (o?.task !== undefined) {
    const t = tasks[o.task]
    if (t.dropped) { emitted.add(i); continue }
    // Условие целиком — одним фрагментом на странице заголовка, даже если в книге
    // оно продолжается на следующей: в читалке задача не разрывается, и фрагмент
    // страницы ровно равен prompt_md. Сверенный ответ — сразу под условием.
    const whole = b.pi === t.pi
    const condHere = whole ? t.condition.filter((k) => !emitted.has(k)) : []
    const ansHere = [...t.answer, ...t.answerImages].filter((k) => flow[k].pi === b.pi && !emitted.has(k)).sort((x, y) => x - y)
    if (condHere.length) {
      const md = fixOptionLabels(condHere.map(blockMd).join('\n\n'))
      const r = append(b.pi, md)
      if (!problemAnchors.has(t)) problemAnchors.set(t, { pi: t.pi, ...r })
      // сверенный ответ в текст страницы не пишем: читалка показывает его из
      // correct_answer, строка «Ответ:» под условием дублировала бы его
    }
    if (ansHere.length && !verified) {
      const text = t.answer.filter((k) => flow[k].pi === b.pi).map((k) => cleanAnswer(flow[k].c)).filter(Boolean).join('; ')
      const imgs = t.answerImages.filter((k) => flow[k].pi === b.pi).map((k) => figureMd(flow[k]))
      append(b.pi, `**Ответ:** ${[text, ...imgs].filter(Boolean).join(' ')}`.trim())
    }
    for (const k of [...condHere, ...ansHere]) emitted.add(k)
    // блоки задачи, не попавшие ни в условие, ни в ответ (пустые, «Дополнительные задачи…»)
    for (const k of t.blocks) if (whole || flow[k].pi === b.pi) emitted.add(k)
    emitted.add(i)
    continue
  }
  if (o?.section !== undefined) {
    if (EXTRA_RE.test(b.c)) inExtraList = true
    // короткие строки после «Дополнительные задачи — в листках:» — названия листков
    // («• Теплообмен. 8», «• Теплообмен. 9–11»), их бывает несколько подряд
    else if (inExtraList && !isFigure(b) && b.c.length < 80) { /* пропускаем */ }
    else {
      inExtraList = false
      if (b.c && !(isFigure(b) && isDecorative(b))) append(b.pi, blockMd(i))
    }
  }
  emitted.add(i)
}

const pageRows = pagesMd.map((parts, pi) => ({ page_index: pi, printed_page: pi + 1, markdown: parts.join('\n\n') }))

// ── 5. Задачи ────────────────────────────────────────────────────────────────
const problems = liveTasks.map((t) => {
  const anchor = problemAnchors.get(t)
  const prompt = fixOptionLabels(t.condition.map(blockMd).join('\n\n'))
  const [c, s] = t.sec.split('.').map(Number)
  const answer = verified
    ? verified.get(t.id) ?? ''
    : t.answerText || (t.answerImages.length ? 'ответ — на рисунке в книге' : '')
  return {
    t,
    task_number: t.id,
    task_number_sort: c * 10_000_000 + s * 100_000 + t.n,
    page_index: t.pi,
    md_start: anchor?.start ?? null,
    md_end: anchor?.end ?? null,
    prompt_md: prompt,
    task_type: 'short_text',
    grading_method: answer && isPlainNumber(answer) ? 'numeric_tolerance' : 'manual',
    correct_answer: answer ? { text: answer } : null,
    answer_source: answer ? 'book_answers' : 'none',
    difficulty: 'advanced',
    has_images: /<img\s/.test(prompt),
    grade: '10-11',
    sectionIdx: t.sectionIdx,
  }
})

// ── Отчёт ────────────────────────────────────────────────────────────────────
const bySec = new Map()
for (const p of problems) bySec.set(p.sectionIdx, [...(bySec.get(p.sectionIdx) ?? []), p.t.n])
const gaps = [...bySec.entries()].filter(([, ns]) => ns.join(',') !== ns.map((_, k) => k + 1).join(',')).map(([s, ns]) => `${sections[s].num}: ${ns.join(',')}`)
console.log('════════ Олимпиадная физика. 11 класс ════════')
console.log('страниц:', raw.length, '· глав:', chapters.length, '· параграфов:', sections.length, `(с задачами: ${bySec.size})`)
console.log('задач:', problems.length, '· с ответом:', problems.filter((p) => p.correct_answer).length,
  '· из них числовых (автопроверка):', problems.filter((p) => p.grading_method === 'numeric_tolerance').length,
  '· ответ картинкой:', liveTasks.filter((t) => t.answerImages.length).length)
console.log('с рисунками:', problems.filter((p) => p.has_images).length, '· кадров рисунков:', crops.size)
console.log('отброшено LIS как ложные заголовки:', dropped.length ? dropped.join(', ') : 'нет')
console.log('исправлен номер параграфа:', renumbered.join(', ') || 'нет')
console.log('нумерация с пропусками:', gaps.length ? gaps.join(' | ') : 'нет')
console.log('без якоря в странице:', problems.filter((p) => p.md_start === null).map((p) => p.task_number).join(', ') || 'нет')
if (verified) {
  const ids = new Set(problems.map((p) => p.task_number))
  console.log('сверенных ответов:', verified.size, '· задач без ответа в книге:', problems.filter((p) => !p.correct_answer).map((p) => p.task_number).join(', ') || 'нет')
  const unknown = [...verified.keys()].filter((k) => !ids.has(k))
  if (unknown.length) { console.error('в файле ответов номера, которых нет среди задач:', unknown.join(', ')); process.exit(1) }
}
// Подозрительные блоки условия: не текст абзаца у левого поля — возможно, рамка ответа
const suspects = liveTasks.flatMap((t) => t.condition
  .filter((i) => i !== t.headerIdx && !isFigure(flow[i]) && (flow[i].bbox[0] >= LEFT_MARGIN_MAX || !['text', 'paragraph_title'].includes(flow[i].label)))
  .map((i) => `${t.id}\t${flow[i].label}\t${flow[i].pi}:${flow[i].bbox.join(',')}\t${flow[i].c.replace(/\s+/g, ' ').slice(0, 140)}`))
console.log('главы:', chapters.map((c) => `${c.num}. ${c.title} (с. ${c.pageStart + 1})`).join(' | '))

if (reportDir) {
  fs.mkdirSync(reportDir, { recursive: true })
  fs.writeFileSync(path.join(reportDir, 'answers.tsv'), problems.map((p) => `${p.task_number}\t${p.grading_method}\t${p.correct_answer?.text ?? '—'}\t${p.t.answer.map((i) => flow[i].label + ':' + flow[i].c.replace(/\s+/g, ' ')).join(' ‖ ')}`).join('\n'))
  fs.writeFileSync(path.join(reportDir, 'sources.txt'), [...new Set(problems.map((p) => (p.prompt_md.match(/^\d+\.\d+\.\d+\.\s*(\([^)]*\))/) ?? [])[1] ?? '—').map((s) => s.replace(/\d{4}/g, 'YYYY')))].sort().join('\n'))
  fs.writeFileSync(path.join(reportDir, 'sections.txt'), sections.map((s) => `${s.num}\t${s.title}\tс.${s.pageStart + 1}\tзадач ${(bySec.get(sections.indexOf(s)) ?? []).length}`).join('\n'))
  fs.writeFileSync(path.join(reportDir, 'pages.md'), pageRows.map((r) => `\n\n======== IDX ${r.page_index} ========\n\n${r.markdown}`).join(''))
  fs.writeFileSync(path.join(reportDir, 'problems.json'), JSON.stringify(problems.map(({ t, ...p }) => ({ ...p, answer_regions: t.answerRegions, answer_from_ocr: t.answer.length > 0 })), null, 1))
  fs.writeFileSync(path.join(reportDir, 'condition-suspects.tsv'), suspects.join('\n'))
  console.log('отчёт:', reportDir)
}

if (dryRun) process.exit(0)

// ── Запись в БД ──────────────────────────────────────────────────────────────
function loadEnv() {
  for (const f of ['.env.import.local', '.env.local', '.env.development.local']) {
    if (!fs.existsSync(f)) continue
    for (const line of fs.readFileSync(f, 'utf-8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  }
}
loadEnv()
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('\nНет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env или .env.import.local).'); process.exit(1) }

// Ссылки на рисунки уже собраны с заглушкой домена — подставляем настоящий.
// Адрес длиннее заглушки, поэтому md_start/md_end сдвигаются на разницу длин
// за каждую заглушку перед смещением (якорь никогда не попадает внутрь ссылки)
const PLACEHOLDER = 'https://example.invalid'
const realBase = url.replace(/\/$/, '')
const shift = (md, offset) => offset + (md.slice(0, offset).split(PLACEHOLDER).length - 1) * (realBase.length - PLACEHOLDER.length)
for (const p of problems) {
  if (p.md_start === null) continue
  const md = pageRows[p.page_index].markdown
  p.md_start = shift(md, p.md_start)
  p.md_end = shift(md, p.md_end)
}
const fixUrl = (s) => s.replaceAll(PLACEHOLDER, realBase)
for (const r of pageRows) r.markdown = fixUrl(r.markdown)
for (const p of problems) p.prompt_md = fixUrl(p.prompt_md)
// самопроверка: фрагмент страницы ровно равен условию (условие целиком на одной странице)
const broken = problems.filter((p) => pageRows[p.page_index].markdown.slice(p.md_start, p.md_end) !== p.prompt_md)
if (broken.length) { console.error('якорь не совпал с условием:', broken.map((p) => p.task_number).join(', ')); process.exit(1) }

async function withRetry(fn, label, attempts = 5) {
  let result
  for (let i = 1; i <= attempts; i++) {
    try { result = await fn() } catch (e) { result = { error: e } }
    if (!result?.error) return result
    if (i === attempts) return result
    console.warn(`  ${label}: попытка ${i} не удалась (${result.error.message}), повтор через ${i}с...`)
    await new Promise((r) => setTimeout(r, i * 1000))
  }
  return result
}

const { createClient } = await import('@supabase/supabase-js')
const sharp = (await import('sharp')).default
// без таймаута запрос через перехват TLS (Avast) иногда висит бесконечно — withRetry его не дождётся
const timedFetch = (input, init = {}) => fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(30_000) })
const db = createClient(url, key, { global: { fetch: timedFetch } })

// Рисунки — до записи книги: без них страницы показали бы битые картинки
fs.mkdirSync(pagesDir, { recursive: true })
async function pageImage(pi) {
  const f = path.join(pagesDir, `p${String(pi).padStart(3, '0')}.jpg`)
  if (!fs.existsSync(f) || fs.statSync(f).size < 1000) {
    const res = await fetch(raw[pi].inputImage, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`страница ${pi}: HTTP ${res.status}`)
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()))
  }
  return f
}
console.log(`\nРисунки: вырезка и загрузка ${crops.size} кадров...`)
let up = 0
for (const c of crops.values()) {
  const [x1, y1, x2, y2] = c.bbox
  const pad = 4
  const left = Math.max(0, x1 - pad), top = Math.max(0, y1 - pad)
  const width = Math.min(PAGE_W - left, x2 - x1 + 2 * pad), height = y2 - y1 + 2 * pad
  const masks = (FIGURE_MASKS[`${c.pi}:${c.bbox.join(',')}`] ?? []).map(([mx1, my1, mx2, my2]) => {
    const l = Math.max(0, mx1 - left), t = Math.max(0, my1 - top)
    const w = Math.min(width - l, mx2 - mx1), h = Math.min(height - t, my2 - my1)
    return { input: { create: { width: w, height: h, channels: 3, background: '#ffffff' } }, left: l, top: t }
  })
  let img = sharp(await pageImage(c.pi)).extract({ left, top, width, height })
  if (masks.length) img = sharp(await img.png().toBuffer()).composite(masks)
  const buf = await img.jpeg({ quality: 88 }).toBuffer()
  const { error } = await withRetry(() => db.storage.from('book-media').upload(c.storagePath, buf, { contentType: 'image/jpeg', upsert: true }), `img ${c.storagePath}`)
  if (error) { console.error('Storage:', error.message); process.exit(1) }
  if (++up % 25 === 0) console.log(`  ...${up}/${crops.size}`)
}
console.log(`Рисунков загружено: ${up}`)

const chapterIds = chapters.map(() => randomUUID())
const sectionIds = sections.map(() => randomUUID())
const lastPage = raw.length - 1
const sectionRows = [
  ...chapters.map((c, i) => ({
    // номер в title не дублируем: читалка сама пишет «Глава N.» / «N.M.» перед названием
    id: chapterIds[i], book_id: bookId, parent_id: null, kind: 'chapter', number: String(c.num),
    title: c.title, page_start: c.pageStart, page_end: (chapters[i + 1]?.pageStart ?? lastPage + 1) - 1,
    sort_order: i, grade: '10-11',
  })),
  ...sections.map((s, i) => ({
    id: sectionIds[i], book_id: bookId, parent_id: s.chapterIdx !== null ? chapterIds[s.chapterIdx] : null, kind: 'paragraph', number: s.num,
    title: s.title, page_start: s.pageStart, page_end: sections[i + 1]?.pageStart ?? lastPage,
    sort_order: chapters.length + i, grade: '10-11',
  })),
]
const problemRows = problems.map(({ t, sectionIdx, ...p }) => ({ ...p, book_id: bookId, section_id: sectionIds[sectionIdx] }))
const bookRow = {
  id: bookId,
  book_type: 'olympiad',
  title: 'Олимпиадная физика. 11 класс',
  authors: 'И. В. Яковлев',
  publisher: 'MathUs.ru',
  publication_year: 2023,
  subject: 'Физика',
  grade: '10-11',
  level: 'олимпиадный',
  description: 'Задачник 11.2023: задачи олимпиад для 10–11 классов (Всеросс ШЭ/МЭ, Физтех, Росатом, Курчатов, «Покори Воробьёвы горы!», «Шаг в будущее», Всесиб и др.) с ответами.',
  page_count: raw.length,
  created_by: null,
  import_meta: {
    source_file: path.basename(file),
    problems: problems.length,
    answers_matched: problems.filter((p) => p.correct_answer).length,
    answers_source: 'сверены вручную по изображениям страниц (в книге ответы перевёрнуты)',
    images: crops.size,
    imported_at: new Date().toISOString(),
  },
}

async function insertBatched(table, rows, batchSize) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const { error } = await withRetry(() => db.from(table).insert(rows.slice(i, i + batchSize)), `${table}@${i}`)
    if (error && error.code !== '23505') { console.error(`${table}@${i}:`, error.message); process.exit(1) }
    await new Promise((r) => setTimeout(r, 300))
  }
}
console.log('\nЗапись в БД...')
{
  const { error } = await withRetry(() => db.from('books').insert(bookRow), 'books')
  if (error) { console.error('books:', error.message); process.exit(1) }
}
await insertBatched('book_sections', sectionRows, 25)
await insertBatched('book_pages', pageRows.map((r) => ({ ...r, book_id: bookId })), 5)
await insertBatched('book_problems', problemRows, 25)
console.log(`\nГотово. book_id = ${bookId}`)
