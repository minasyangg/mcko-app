// Пересчёт якорей заданий в markdown страницы книги.
// Используется после редактирования текста страницы или задания:
// смещения md_start/md_end сдвигаются, ищем номера заново.

export interface Anchor {
  start: number
  end: number
}

// Задания «Домашних контрольных работ» хранятся с уникальным номером
// вида «к1.2.3» (контрольная 1, вариант 2, задание 3), но в тексте книги
// они напечатаны просто как «3.». Видимый номер — последний компонент.
const DKR_RE = /^к(\d+)\.(\d+)\.(\d+)$/

export function isDkrNumber(taskNumber: string): boolean {
  return DKR_RE.test(taskNumber)
}

export function visibleTaskNumber(taskNumber: string): string {
  const m = taskNumber.match(DKR_RE)
  return m ? m[3] : taskNumber
}

// «к1.2.3» → метка для бейджа: «ДКР 1 · вар. 2 · № 3»
export function taskNumberLabel(taskNumber: string): string {
  const m = taskNumber.match(DKR_RE)
  return m ? `ДКР ${m[1]} · вар. ${m[2]} · № ${m[3]}` : `№ ${taskNumber}`
}

// Для каждого номера из taskNumbers находит "N. " или "N.M. " (нумерация
// по параграфам, Мордкович) в начале строки; перед номером допускается
// значок уровня сложности (∞/⑤) или кружок «задание с ответом», который
// OCR читает как o/O/0/о/О; после точки — пробел либо сразу маркер
// подпункта ("o11.10.a)"). end = начало следующего задания или конец страницы.
export function computeAnchors(pageMd: string, taskNumbers: string[]): Map<string, Anchor> {
  const plainWanted = new Set(taskNumbers.filter(t => !isDkrNumber(t)))
  // ДКР-задания: видимые номера повторяются между вариантами (1..10 в каждом),
  // поэтому сопоставляем позиционно — задания в порядке (контрольная, вариант,
  // номер) против кандидатов в порядке появления в тексте
  const dkrOrdered = taskNumbers
    .filter(isDkrNumber)
    .sort((a, b) => {
      const [, a1, a2, a3] = a.match(DKR_RE)!
      const [, b1, b2, b3] = b.match(DKR_RE)!
      return (+a1 - +b1) || (+a2 - +b2) || (+a3 - +b3)
    })

  const candidates: Array<{ num: string; at: number }> = []
  const re = /^[ \t]*(?:(?:[^0-9A-Za-zА-Яа-яЁё#<\s$([{]|[oOоОοΟ0])[ \t]{0,2})?(\d{1,2}\.\d{1,3}|\d{1,4})\.(?:[ \t]|(?=[а-еa-z6ΓB]\)))/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(pageMd)) !== null) {
    candidates.push({ num: m[1], at: m.index })
  }

  const assigned = new Map<string, number>() // task_number → candidate index
  const taken = new Set<number>()
  for (let i = 0; i < candidates.length; i++) {
    if (plainWanted.has(candidates[i].num) && !assigned.has(candidates[i].num)) {
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
