// Пересчёт якорей заданий в markdown страницы книги.
// Используется после редактирования текста страницы или задания:
// смещения md_start/md_end сдвигаются, ищем номера заново.

export interface Anchor {
  start: number
  end: number
}

// Зонные номера: задания вне сквозной нумерации книги хранятся с составным
// уникальным номером, а в тексте книги напечатан только последний компонент:
//   к1.2.3 — домашняя контрольная работа (задачник):  «ДКР 1 · вар. 2 · № 3»
//   р2.1.4 — контрольная работа (дидактика):          «КР 2 · вар. 1 · № 4»
//   с5.2.3 — самостоятельная работа (дидактика):      «СР 5 · вар. 2 · № 3»
//   п3.1.2 — проверочная работа (дидактика):          «ПР 3 · вар. 1 · № 2»
//   в2.157 — вариант со сквозной нумерацией:          «вар. 2 · № 157»
const ZONE3_RE = /^([крсп])(\d+)\.(\d+)\.(\d+)$/
const ZONE2_RE = /^в(\d+)\.(\d+)$/
const KIND_LABEL: Record<string, string> = { к: 'ДКР', р: 'КР', с: 'СР', п: 'ПР' }

export function isZoneNumber(taskNumber: string): boolean {
  return ZONE3_RE.test(taskNumber) || ZONE2_RE.test(taskNumber)
}

export function visibleTaskNumber(taskNumber: string): string {
  const m3 = taskNumber.match(ZONE3_RE)
  if (m3) return m3[4]
  const m2 = taskNumber.match(ZONE2_RE)
  if (m2) return m2[2]
  return taskNumber
}

export function taskNumberLabel(taskNumber: string): string {
  const m3 = taskNumber.match(ZONE3_RE)
  if (m3) return `${KIND_LABEL[m3[1]]} ${m3[2]} · вар. ${m3[3]} · № ${m3[4]}`
  const m2 = taskNumber.match(ZONE2_RE)
  if (m2) return `вар. ${m2[1]} · № ${m2[2]}`
  return `№ ${taskNumber}`
}

// Порядок зонных заданий в документе, когда task_number_sort недоступен
function zoneSortKey(taskNumber: string): number {
  const m3 = taskNumber.match(ZONE3_RE)
  if (m3) return (+m3[2]) * 1_000_000 + (+m3[3]) * 10_000 + (+m3[4])
  const m2 = taskNumber.match(ZONE2_RE)
  if (m2) return (+m2[1]) * 1_000_000 + (+m2[2])
  return 0
}

// Для каждого номера из taskNumbers находит "N. " или "N.M. " (нумерация
// по параграфам, Мордкович) в начале строки; перед номером допускается
// значок уровня сложности (∞/⑤) или кружок «задание с ответом», который
// OCR читает как o/O/0/о/О; после точки — пробел либо сразу маркер
// подпункта ("o11.10.a)"). end = начало следующего задания или конец страницы.
export function computeAnchors(
  pageMd: string,
  taskNumbers: string[],
  // task_number → task_number_sort: точный порядок заданий в документе
  // (важно, когда на странице соседствуют работы разных видов)
  sortHint?: Map<string, number>,
): Map<string, Anchor> {
  const plainWanted = new Set(taskNumbers.filter(t => !isZoneNumber(t)))
  // Зонные задания: видимые номера повторяются между вариантами/работами,
  // поэтому сопоставляем позиционно — задания в порядке документа против
  // кандидатов в порядке появления в тексте
  const dkrOrdered = taskNumbers
    .filter(isZoneNumber)
    .sort((a, b) =>
      (sortHint?.get(a) ?? zoneSortKey(a)) - (sortHint?.get(b) ?? zoneSortKey(b)))

  // Кандидаты двух стилей: «N.» (учебники, задачники) и «N)» (часть дидактики).
  // Сквозные номера сопоставляются только по точечному стилю (цифровые
  // подпункты «1) 2)» внутри заданий не должны красть якорь), зонные —
  // позиционно по обоим стилям.
  const candidates: Array<{ num: string; at: number; paren: boolean }> = []
  const dotRe = /^[ \t]*(?:(?:[^0-9A-Za-zА-Яа-яЁё#<\s$([{]|[oOоОοΟ0])[ \t]{0,2})?(\d{1,2}\.\d{1,3}|\d{1,4})[*°]?\.(?:[ \t]|(?=[а-еa-z6ΓB]\)))/gm
  const parenRe = /^[ \t]*(\d{1,2})[*°]?\)[*°]?[ \t]/gm
  let m: RegExpExecArray | null
  while ((m = dotRe.exec(pageMd)) !== null) {
    candidates.push({ num: m[1], at: m.index, paren: false })
  }
  while ((m = parenRe.exec(pageMd)) !== null) {
    candidates.push({ num: m[1], at: m.index, paren: true })
  }
  candidates.sort((a, b) => a.at - b.at)

  const assigned = new Map<string, number>() // task_number → candidate index
  const taken = new Set<number>()
  for (let i = 0; i < candidates.length; i++) {
    if (!candidates[i].paren && plainWanted.has(candidates[i].num) && !assigned.has(candidates[i].num)) {
      assigned.set(candidates[i].num, i)
      taken.add(i)
    }
  }
  let ptr = 0
  for (const t of dkrOrdered) {
    const vis = visibleTaskNumber(t)
    for (let i = ptr; i < candidates.length; i++) {
      if (taken.has(i) || candidates[i].num !== vis) continue
      assigned.set(t, i)
      taken.add(i)
      ptr = i + 1
      break
    }
  }

  // end = позиция следующего назначенного якоря либо конец страницы
  const ordered = [...assigned.entries()]
    .map(([num, i]) => ({ num, at: candidates[i].at }))
    .sort((a, b) => a.at - b.at)
  const out = new Map<string, Anchor>()
  for (let i = 0; i < ordered.length; i++) {
    out.set(ordered[i].num, {
      start: ordered[i].at,
      end: i + 1 < ordered.length ? ordered[i + 1].at : pageMd.length,
    })
  }
  return out
}
