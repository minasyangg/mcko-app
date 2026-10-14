import { compileExpression } from './expression'

// Описания рисунков внутри markdown — блоки ```graph и ```chart (рендер —
// components/shared/plots). Формат построчный и рассчитан на учителя, а не на
// программиста; непонятная строка не роняет рисунок, а попадает в errors.

const NUM = String.raw`[-−–]?\d+(?:[.,]\d+)?`
const toNum = (s: string) => Number(s.replace(/[−–]/, '-').replace(',', '.'))

export interface GraphFunction { label: string; fn: (x: number) => number }
export interface GraphPoint { x: number; y: number; label: string }
export interface GraphPolyline { points: [number, number][]; label: string }

export interface GraphSpec {
  functions: GraphFunction[]
  xRange: [number, number] | null
  yRange: [number, number] | null
  points: GraphPoint[]
  /** Вертикальные пунктирные прямые x = a (например, ось симметрии параболы) */
  vlines: number[]
  /** Ломаные по точкам — графики из физики: участки движения, нагрев/плавление */
  polylines: GraphPolyline[]
  /** Подписи осей («t, с» и «v, м/с»). Заданы — масштабы осей независимые,
   *  как на физических графиках; не заданы — «математический» равный масштаб. */
  axes: { x: string; y: string } | null
  errors: string[]
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ```graph
// y = x^2 - 4x + 3
// y = 2(x - 1)^2
// x: -2..6          (или «x от -2 до 6»; по умолчанию -5..5)
// y: -2..8          (необязательно — подбирается сам)
// x = 2             (пунктирная вертикальная прямая)
// точка: (2; -1) A  (координаты через «;», подпись необязательна)
//
// Физика:
// оси: t, с; v, м/с              (подписи осей; масштабы по осям независимые)
// v = 2 + 3t                     (формула в буквах осей: t вместо x)
// ломаная: (0; 20) (5; 20) (10; 80) нагрев   (точки через «;» внутри скобок)
// t = 5                          (пунктир при t = 5)
// Диапазоны по-прежнему «x: 0..10» и «y: 0..80» — горизонталь и вертикаль.
export function parseGraphSpec(text: string): GraphSpec {
  const spec: GraphSpec = { functions: [], xRange: null, yRange: null, points: [], vlines: [], polylines: [], axes: null, errors: [] }
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))

  // Оси читаем первыми: от их букв зависит разбор формул и пунктиров
  const axesRe = /^(?:оси|axes)\s*:\s*(.+)$/i
  for (const line of lines) {
    const m = line.match(axesRe)
    if (!m) continue
    const [x, y] = m[1].split(/\s*[;|]\s*/)
    if (x && y) spec.axes = { x: x.trim(), y: y.trim() }
    else spec.errors.push(`«${line}»: оси записываются как «оси: t, с; v, м/с»`)
  }
  // буква оси — до запятой: «t, с» → t; «v_x, м/с» → v_x; «τ, мин» → τ
  const sym = (label: string | undefined) => label?.split(',')[0].trim().match(/^[A-Za-zА-Яа-яΑ-Ωα-ω](?:_?[A-Za-zА-Яа-я0-9]+)?$/)?.[0] ?? null
  const xSym = sym(spec.axes?.x)
  const ySym = sym(spec.axes?.y)
  // без флага i: в физике «t» (время) и «T» (температура) — разные оси.
  // На графике координаты x(t) вертикальная ось — x: «x = 3» там значит
  // «стоит в точке 3» (формула), а не вертикальный пунктир
  const xNames = [...(ySym === 'x' || ySym === 'X' ? [] : ['x', 'X']), ...(xSym && xSym !== 'x' ? [esc(xSym)] : [])].join('|') || 'x'
  const yNames = ['y', ...(ySym && ySym !== 'y' ? [esc(ySym)] : [])].join('|')

  const rangeRe = new RegExp(String.raw`^([xy])\s*(?::|от)\s*(${NUM})\s*(?:\.\.|…|до)\s*(${NUM})$`, 'i')
  const vlineRe = new RegExp(String.raw`^(?:${xNames})\s*=\s*(${NUM})$`)
  const pointRe = /^(?:точка|point)\s*:?\s*\(\s*([^)]+?)\s*\)\s*(.*)$/i
  const polyRe = /^(?:ломаная|линия|line)\s*:\s*(.+)$/i
  // в физике слева может стоять любое обозначение: «E_п = h», «E_к = 1,8 - h»
  // (пунктир «t = 5» с числом справа разобран раньше)
  const lhs = spec.axes ? String.raw`[A-Za-zА-Яа-яΑ-Ωα-ω][A-Za-zА-Яа-я0-9_]*` : yNames
  const funcRe = new RegExp(String.raw`^(?:${lhs}|[a-zа-я]\s*\(\s*(?:${xNames})\s*\))\s*=\s*(.+)$`, 'i')

  for (const line of lines) {
    if (axesRe.test(line)) continue
    let m: RegExpMatchArray | null
    if ((m = line.match(rangeRe))) {
      const a = toNum(m[2]), b = toNum(m[3])
      if (a < b) {
        if (m[1].toLowerCase() === 'x') spec.xRange = [a, b]
        else spec.yRange = [a, b]
      } else spec.errors.push(`«${line}»: начало диапазона должно быть меньше конца`)
    } else if ((m = line.match(vlineRe))) {
      spec.vlines.push(toNum(m[1]))
    } else if ((m = line.match(polyRe))) {
      const pts: [number, number][] = []
      let last = 0
      for (const pm of m[1].matchAll(/\(\s*([^;()]+?)\s*;\s*([^;()]+?)\s*\)/g)) {
        const x = toNum(pm[1]), y = toNum(pm[2])
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y])
        last = (pm.index ?? 0) + pm[0].length
      }
      if (pts.length >= 2) spec.polylines.push({ points: pts, label: m[1].slice(last).trim() })
      else spec.errors.push(`«${line}»: нужны хотя бы две точки вида (x; y)`)
    } else if ((m = line.match(pointRe))) {
      // «(1,5; 2)» — «;» разделяет координаты, запятая десятичная;
      // «(1, 2)» — запятая разделяет координаты
      const parts = m[1].includes(';') ? m[1].split(';') : m[1].split(',')
      const [x, y] = parts.map((p) => toNum(p.trim()))
      if (parts.length === 2 && Number.isFinite(x) && Number.isFinite(y)) spec.points.push({ x, y, label: m[2].trim() })
      else spec.errors.push(`«${line}»: точка записывается как (x; y)`)
    } else if ((m = line.match(funcRe))) {
      // «v = 2 + 3t»: буква горизонтальной оси → x (только отдельно стоящая —
      // t в sqrt и tg не трогаем)
      const body = xSym && xSym !== 'x'
        ? m[1].replace(new RegExp(String.raw`(?<![A-Za-zА-Яа-яΑ-Ωα-ω_])${esc(xSym)}(?![A-Za-zА-Яа-яΑ-Ωα-ω0-9_])`, 'g'), 'x')
        : m[1]
      try {
        spec.functions.push({ label: line.replace(/\s+/g, ' '), fn: compileExpression(body) })
      } catch (e) {
        spec.errors.push(`«${line}»: ${(e as Error).message}`)
      }
    } else {
      spec.errors.push(`Не понял строку «${line}»`)
    }
  }
  return spec
}

export type ChartType = 'bar' | 'pie' | 'line'

export interface ChartSpec {
  type: ChartType
  title: string | null
  items: { label: string; value: number }[]
  errors: string[]
}

const TYPE_ALIASES: Record<string, ChartType> = {
  'столбики': 'bar', 'столбчатая': 'bar', 'столбиковая': 'bar', 'bar': 'bar',
  'круговая': 'pie', 'круг': 'pie', 'pie': 'pie',
  'линия': 'line', 'линейная': 'line', 'line': 'line',
}

// ```chart
// тип: столбики        (столбики | круговая | линия)
// заголовок: Продажа шоколада
// Пн: 8
// Вт: 5
export function parseChartSpec(text: string): ChartSpec {
  const spec: ChartSpec = { type: 'bar', title: null, items: [], errors: [] }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.lastIndexOf(':')
    if (idx <= 0) { spec.errors.push(`Не понял строку «${line}» — нужно «подпись: число»`); continue }
    const key = line.slice(0, idx).trim()
    const val = line.slice(idx + 1).trim()
    const keyLc = key.toLowerCase()
    if (keyLc === 'тип' || keyLc === 'type') {
      const t = TYPE_ALIASES[val.toLowerCase()]
      if (t) spec.type = t
      else spec.errors.push(`Тип «${val}» неизвестен: столбики, круговая или линия`)
    } else if (keyLc === 'заголовок' || keyLc === 'название' || keyLc === 'title') {
      spec.title = val
    } else {
      const v = toNum(val.replace('%', '').trim())
      if (Number.isFinite(v)) spec.items.push({ label: key, value: v })
      else spec.errors.push(`«${line}»: после двоеточия нужно число`)
    }
  }
  if (spec.type === 'pie' && spec.items.some((i) => i.value < 0)) spec.errors.push('В круговой диаграмме значения не могут быть отрицательными')
  return spec
}

const MAX_TICKS = 200

// «Красивые» деления оси: шаг 1, 2 или 5 × 10^k.
// Деления считаются по номеру k·step, а не накоплением v += step: при
// больших числах (y = 10^16) шаг меньше точности double, v не растёт, и
// цикл с накоплением вешал страницу — у ученика и при рендере на сервере.
export function niceTicks(min: number, max: number, maxCount = 10): { step: number; ticks: number[] } {
  const span = max - min
  if (!Number.isFinite(span) || !(span > 0) || !(maxCount >= 1)) {
    return { step: 1, ticks: Number.isFinite(min) ? [min] : [] }
  }
  const raw = span / maxCount
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag
  const first = Math.ceil(min / step)
  const last = Math.floor(max / step + 1e-9)
  if (!(step > 0) || !Number.isFinite(first) || !Number.isFinite(last) || last - first > MAX_TICKS) {
    return { step, ticks: [] }
  }
  // счётчик — маленькое целое: k++ при k ~ 10^16 тоже не растёт
  const ticks: number[] = []
  for (let i = 0; i <= last - first; i++) ticks.push((first + i) * step)
  // соседние деления неотличимы в double — подписи слились бы в одну
  return { step, ticks: new Set(ticks).size === ticks.length ? ticks : [] }
}

// Число для подписи: десятичная запятая, без лишних нулей
export function fmtNum(n: number): string {
  const r = Math.round(n * 1000) / 1000
  return String(Object.is(r, -0) ? 0 : r).replace('.', ',')
}

// Подпись функции в легенде: «y = x^2 - 4x» → «y = x² − 4x»
// Индексы: «v_0» → v₀, «v_x» → vₓ; у прочих букв («E_п») подчёркивание просто
// убираем — нижних индексов кириллицы в Юникоде нет.
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', x: 'ₓ' }
export function prettyFormula(s: string): string {
  return s.replace(/\^2(?![0-9])/g, '²').replace(/\^3(?![0-9])/g, '³').replace(/\*/g, '·').replace(/(\s)-(\s)/g, '$1−$2')
    .replace(/_([A-Za-zА-Яа-я0-9]+)/g, (_, idx: string) => [...idx].every((c) => SUB[c]) ? [...idx].map((c) => SUB[c]).join('') : idx)
}
