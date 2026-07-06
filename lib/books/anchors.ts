// Пересчёт якорей заданий в markdown страницы книги.
// Используется после редактирования текста страницы или задания:
// смещения md_start/md_end сдвигаются, ищем номера заново.

export interface Anchor {
  start: number
  end: number
}

// Для каждого номера из taskNumbers находит "N. " или "N.M. " (нумерация
// по параграфам, Мордкович) в начале строки; перед номером допускается
// значок уровня сложности (∞/⑤). end = начало следующего задания или конец страницы.
export function computeAnchors(pageMd: string, taskNumbers: string[]): Map<string, Anchor> {
  const wanted = new Set(taskNumbers)
  const starts: Array<{ num: string; at: number }> = []
  const re = /^[ \t]*(?:[^0-9A-Za-zА-Яа-яЁё#<\s$([{][ \t]{0,2})?(\d{1,2}\.\d{1,3}|\d{1,4})\.[ \t]/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(pageMd)) !== null) {
    if (wanted.has(m[1])) starts.push({ num: m[1], at: m.index })
  }
  starts.sort((a, b) => a.at - b.at)

  const out = new Map<string, Anchor>()
  for (let i = 0; i < starts.length; i++) {
    if (out.has(starts[i].num)) continue // дубль номера — берём первое вхождение
    out.set(starts[i].num, {
      start: starts[i].at,
      end: i + 1 < starts.length ? starts[i + 1].at : pageMd.length,
    })
  }
  return out
}
