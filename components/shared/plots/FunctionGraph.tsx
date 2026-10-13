'use client'

import { useMemo } from 'react'
import { fmtNum, niceTicks, parseGraphSpec, prettyFormula } from '@/lib/plot/spec'

const W = 560
const PAD = 14
const MIN_PLOT_H = 232
const MAX_PLOT_H = 492
const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2']
const SAMPLES = 600

// График функций из блока ```graph (формат — lib/plot/spec.ts). Рисуется в
// SVG на клиенте, без внешних библиотек. Масштаб по осям одинаковый, если
// диапазоны соизмеримы, — иначе парабола выглядела бы сплющенной.
export function FunctionGraph({ spec: source }: { spec: string }) {
  const g = useMemo(() => build(source), [source])

  return (
    <figure className="my-3 w-full max-w-xl">
      {g.drawable && (
        <svg viewBox={`0 0 ${W} ${g.H}`} className="h-auto w-full text-foreground" role="img" aria-label="График функции">
          <defs>
            <clipPath id={g.clipId}><rect x={PAD} y={PAD} width={W - 2 * PAD} height={g.H - 2 * PAD} /></clipPath>
            <marker id={`${g.clipId}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
            </marker>
          </defs>
          {/* сетка */}
          <g stroke="currentColor" strokeOpacity={0.12} strokeWidth={1}>
            {g.xTicks.map((t) => <line key={`gx${t}`} x1={g.px(t)} y1={PAD} x2={g.px(t)} y2={g.H - PAD} />)}
            {g.yTicks.map((t) => <line key={`gy${t}`} x1={PAD} y1={g.py(t)} x2={W - PAD} y2={g.py(t)} />)}
          </g>
          {/* оси */}
          <g stroke="currentColor" strokeWidth={1.4}>
            <line x1={PAD} y1={g.axisY} x2={W - PAD} y2={g.axisY} markerEnd={`url(#${g.clipId}-arrow)`} />
            <line x1={g.axisX} y1={g.H - PAD} x2={g.axisX} y2={PAD} markerEnd={`url(#${g.clipId}-arrow)`} />
          </g>
          <g fill="currentColor" fontSize={12} opacity={0.75}>
            {g.xTicks.filter((t) => t !== 0).map((t) => (
              <text key={`lx${t}`} x={g.px(t)} y={Math.min(g.axisY + 15, g.H - 3)} textAnchor="middle">{fmtNum(t)}</text>
            ))}
            {g.yTicks.filter((t) => t !== 0).map((t) => (
              <text key={`ly${t}`} x={Math.max(g.axisX - 5, 22)} y={g.py(t) + 4} textAnchor="end">{fmtNum(t)}</text>
            ))}
            {g.originVisible && <text x={g.axisX - 5} y={g.axisY + 15} textAnchor="end">0</text>}
          </g>
          <g fill="currentColor" fontSize={14} fontStyle="italic">
            <text x={W - PAD - 4} y={g.axisY - 8} textAnchor="end">x</text>
            <text x={g.axisX + 8} y={PAD + 12}>y</text>
          </g>
          <g clipPath={`url(#${g.clipId})`}>
            {g.vlines.map((v) => (
              <line key={`v${v}`} x1={g.px(v)} y1={PAD} x2={g.px(v)} y2={g.H - PAD} stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.3} strokeDasharray="6 4" />
            ))}
            {g.paths.map((d, i) => (
              <path key={`f${i}`} d={d} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {g.points.map((p, i) => (
              <g key={`p${i}`}>
                <circle cx={g.px(p.x)} cy={g.py(p.y)} r={4} fill="currentColor" />
                {p.label && <text x={g.px(p.x) + 7} y={g.py(p.y) - 7} fontSize={13} fill="currentColor" fontWeight={600}>{p.label}</text>}
              </g>
            ))}
          </g>
        </svg>
      )}
      {g.legend.length > 0 && (
        <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {g.legend.map((l, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-5 rounded" style={{ background: COLORS[i % COLORS.length] }} />
              {prettyFormula(l)}
            </span>
          ))}
        </figcaption>
      )}
      {g.errors.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs text-destructive">
          {g.errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </figure>
  )
}

function build(source: string) {
  const spec = parseGraphSpec(source)
  const errors = [...spec.errors]

  const [x0, x1] = spec.xRange ?? defaultX(spec)
  // выборка значений — и для путей, и для автоподбора диапазона по y
  const samples = spec.functions.map((f) => {
    const pts: [number, number][] = []
    for (let i = 0; i <= SAMPLES; i++) {
      const x = x0 + ((x1 - x0) * i) / SAMPLES
      let y: number
      try { y = f.fn(x) } catch { y = NaN }
      pts.push([x, y])
    }
    return pts
  })

  const auto = autoY(samples, spec.points.map((p) => p.y))
  let [y0, y1] = spec.yRange ?? auto.range

  // Высота холста — по пропорции осей, чтобы клетка по x и по y была одного
  // размера (как в тетради), иначе парабола выглядит сплющенной. Если y не
  // задан и график выходит слишком высоким — режем окно по y со стороны,
  // дальней от «интересной» части (у параболы ветвями вверх — сверху).
  const plotW = W - 2 * PAD
  let plotH = (plotW * (y1 - y0)) / (x1 - x0)
  if (!spec.yRange && plotH > MAX_PLOT_H) {
    const span = (MAX_PLOT_H * (x1 - x0)) / plotW
    if (auto.median - y0 <= y1 - auto.median) y1 = y0 + span
    else y0 = y1 - span
    plotH = MAX_PLOT_H
  } else if (!spec.yRange && plotH < MIN_PLOT_H) {
    const span = (MIN_PLOT_H * (x1 - x0)) / plotW
    const c = (y0 + y1) / 2
    ;[y0, y1] = [c - span / 2, c + span / 2]
    plotH = MIN_PLOT_H
  } else {
    // заданные учителем диапазоны соблюдаем; если пропорция крайняя —
    // высота упирается в предел, и масштабы по осям немного различаются
    plotH = Math.min(MAX_PLOT_H, Math.max(MIN_PLOT_H, plotH))
  }
  const H = plotH + 2 * PAD

  const px = (x: number) => PAD + ((x - x0) / (x1 - x0)) * plotW
  const py = (y: number) => PAD + ((y1 - y) / (y1 - y0)) * plotH

  const jump = (y1 - y0) * 2
  const paths = samples.map((pts) => {
    let d = ''
    let prev: number | null = null
    for (const [x, y] of pts) {
      if (!Number.isFinite(y) || Math.abs(y) > 1e6) { prev = null; continue }
      // разрыв (асимптота у 1/x) — новый отрезок, а не вертикальная черта
      const cmd = prev === null || Math.abs(y - prev) > jump ? 'M' : 'L'
      d += `${cmd}${px(x).toFixed(1)},${py(y).toFixed(1)} `
      prev = y
    }
    return d.trim()
  })
  spec.functions.forEach((f, i) => { if (!paths[i]) errors.push(`«${f.label}»: на этом отрезке функция не определена`) })

  const xTicks = niceTicks(x0, x1, Math.floor(plotW / 42)).ticks
  // плотность делений по y та же, что по x: при равном масштабе шаг совпадает,
  // и подписи «4,5 · 4 · 3,5…» не налезают друг на друга
  const yTicks = niceTicks(y0, y1, Math.floor(plotH / 42)).ticks
  const axisX = px(Math.min(Math.max(0, x0), x1))
  const axisY = py(Math.min(Math.max(0, y0), y1))

  return {
    drawable: spec.functions.length > 0 || spec.points.length > 0 || spec.vlines.length > 0,
    H, clipId: `g${hash(source)}`,
    px, py, paths, xTicks, yTicks, axisX, axisY,
    originVisible: x0 < 0 && x1 > 0 && y0 < 0 && y1 > 0,
    points: spec.points, vlines: spec.vlines,
    legend: spec.functions.map((f) => f.label),
    errors,
  }
}

function defaultX(spec: ReturnType<typeof parseGraphSpec>): [number, number] {
  const xs = [...spec.points.map((p) => p.x), ...spec.vlines]
  if (xs.length === 0) return [-5, 5]
  const lo = Math.min(-1, ...xs) - 2, hi = Math.max(1, ...xs) + 2
  return [lo, hi]
}

function autoY(samples: [number, number][][], extra: number[]): { range: [number, number]; median: number } {
  const ys = samples.flat().map(([, y]) => y).filter((y) => Number.isFinite(y) && Math.abs(y) < 1e6).sort((a, b) => a - b)
  const all = [...ys, ...extra]
  if (all.length === 0) return { range: [-5, 5], median: 0 }
  const median = ys.length ? ys[Math.floor(ys.length / 2)] : extra[0]
  // крайние 2% отбрасываем — у гипербол значения у асимптоты улетают в бесконечность
  let lo = ys.length ? ys[Math.floor(ys.length * 0.02)] : Math.min(...extra)
  let hi = ys.length ? ys[Math.ceil(ys.length * 0.98) - 1] : Math.max(...extra)
  for (const e of extra) { lo = Math.min(lo, e); hi = Math.max(hi, e) }
  const span = hi - lo || 2
  if (lo > 0 && lo <= span * 1.5) lo = 0
  if (hi < 0 && -hi <= span * 1.5) hi = 0
  const pad = (hi - lo || 2) * 0.1
  return { range: [lo - pad, hi + pad], median }
}

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
