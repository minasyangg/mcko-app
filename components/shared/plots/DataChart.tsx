'use client'

import { useMemo } from 'react'
import { fmtNum, niceTicks, parseChartSpec, type ChartSpec } from '@/lib/plot/spec'

const W = 560
const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d']

// Диаграмма из блока ```chart (формат — lib/plot/spec.ts): столбиковая,
// круговая или линейная. SVG без внешних библиотек.
export function DataChart({ spec: source }: { spec: string }) {
  const spec = useMemo(() => parseChartSpec(source), [source])
  return (
    <figure className="my-3 w-full max-w-xl">
      {spec.title && <figcaption className="mb-1 text-center text-sm font-medium">{spec.title}</figcaption>}
      {spec.items.length > 0 && (spec.type === 'pie' ? <Pie spec={spec} /> : <Bars spec={spec} />)}
      {spec.errors.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs text-destructive">
          {spec.errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </figure>
  )
}

function Bars({ spec }: { spec: ChartSpec }) {
  const H = 300
  const left = 44, right = 12, top = 16
  const many = spec.items.length > 7
  const bottom = many ? 70 : 34
  const values = spec.items.map((i) => i.value)
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values)
  const { ticks } = niceTicks(lo, hi === lo ? lo + 1 : hi, 6)
  const yMin = Math.min(lo, ticks[0]), yMax = Math.max(hi, ticks[ticks.length - 1])
  const plotW = W - left - right, plotH = H - top - bottom
  const py = (v: number) => top + ((yMax - v) / (yMax - yMin || 1)) * plotH
  const slot = plotW / spec.items.length
  const cx = (i: number) => left + slot * (i + 0.5)
  const line = spec.type === 'line'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full text-foreground" role="img" aria-label={spec.title ?? 'Диаграмма'}>
      <g stroke="currentColor" strokeOpacity={0.12}>
        {ticks.map((t) => <line key={t} x1={left} y1={py(t)} x2={W - right} y2={py(t)} />)}
      </g>
      <g fill="currentColor" fontSize={12} opacity={0.75}>
        {ticks.map((t) => <text key={t} x={left - 6} y={py(t) + 4} textAnchor="end">{fmtNum(t)}</text>)}
      </g>
      <line x1={left} y1={py(0)} x2={W - right} y2={py(0)} stroke="currentColor" strokeWidth={1.3} />
      {line ? (
        <>
          <polyline
            points={spec.items.map((it, i) => `${cx(i)},${py(it.value)}`).join(' ')}
            fill="none" stroke={COLORS[0]} strokeWidth={2.5} strokeLinejoin="round"
          />
          {spec.items.map((it, i) => <circle key={i} cx={cx(i)} cy={py(it.value)} r={4} fill={COLORS[0]} />)}
        </>
      ) : (
        spec.items.map((it, i) => {
          const y = py(Math.max(it.value, 0)), h = Math.abs(py(it.value) - py(0))
          return <rect key={i} x={cx(i) - slot * 0.3} y={y} width={slot * 0.6} height={h} rx={2} fill={COLORS[0]} fillOpacity={0.85} />
        })
      )}
      <g fill="currentColor" fontSize={12}>
        {spec.items.map((it, i) => (
          <text key={`v${i}`} x={cx(i)} y={py(it.value) - 6} textAnchor="middle" fontWeight={600}>{fmtNum(it.value)}</text>
        ))}
        {spec.items.map((it, i) => many ? (
          <text key={`l${i}`} x={cx(i)} y={H - bottom + 14} textAnchor="end" transform={`rotate(-35 ${cx(i)} ${H - bottom + 14})`}>{it.label}</text>
        ) : (
          <text key={`l${i}`} x={cx(i)} y={H - bottom + 18} textAnchor="middle">{it.label}</text>
        ))}
      </g>
    </svg>
  )
}

// Секторы круговой диаграммы: углы накапливаются по порядку значений, начиная
// с «12 часов». Отдельной функцией вне компонента — расчёт чистый.
function pieSectors(items: ChartSpec['items'], cx: number, cy: number, r: number) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1
  const sectors = []
  let angle = -Math.PI / 2
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const share = it.value / total
    const a0 = angle, a1 = angle + share * 2 * Math.PI
    angle = a1
    const large = a1 - a0 > Math.PI ? 1 : 0
    const p = (a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
    const d = share >= 0.9999
      ? `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`
      : `M${cx},${cy} L${p(a0)} A${r},${r} 0 ${large},1 ${p(a1)} z`
    const mid = (a0 + a1) / 2
    sectors.push({ d, share, color: COLORS[i % COLORS.length], label: it.label, value: it.value, lx: cx + r * 0.62 * Math.cos(mid), ly: cy + r * 0.62 * Math.sin(mid) })
  }
  return sectors
}

function Pie({ spec }: { spec: ChartSpec }) {
  const H = Math.max(260, 40 + spec.items.length * 24)
  const cx = 140, cy = H / 2, r = 110
  const sectors = pieSectors(spec.items, cx, cy, r)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full text-foreground" role="img" aria-label={spec.title ?? 'Круговая диаграмма'}>
      {sectors.map((s, i) => <path key={i} d={s.d} fill={s.color} stroke="var(--background, #fff)" strokeWidth={1.5} />)}
      {sectors.map((s, i) => s.share >= 0.05 && (
        <text key={`t${i}`} x={s.lx} y={s.ly + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="#fff">
          {fmtNum(Math.round(s.share * 1000) / 10)}%
        </text>
      ))}
      <g fontSize={13} fill="currentColor">
        {sectors.map((s, i) => {
          const y = cy - (sectors.length * 24) / 2 + i * 24 + 12
          return (
            <g key={`l${i}`}>
              <rect x={290} y={y - 10} width={14} height={14} rx={2} fill={s.color} />
              <text x={312} y={y + 2}>{s.label} — {fmtNum(s.value)}</text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}
