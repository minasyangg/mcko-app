import { ImageResponse } from 'next/og'

// Иконка вкладки браузера. Next.js App Router рендерит этот файл в PNG на
// лету и сам подставляет нужные <link rel="icon"> — ручной favicon.ico не
// нужен. Пиксель-арт глитч: тёмный фон, крупный блочный смайл-череп и
// смещённые по каналам (RGB-сплит) дубликаты того же контура — отсылка к
// глитч-эстетике видеокассет/ретро-игр, а не к «школьной оценке».
export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

// 8×8 битмаска пиксельного черепа (1 = закрашенный «пиксель», блок 4×4px —
// на холсте 32×32 это заполняет иконку целиком, а не мелкую фигуру в углу)
const GRID = [
  '01111110',
  '11111111',
  '11011011',
  '11111111',
  '11100111',
  '01111110',
  '00101100',
  '00100100',
]

function pixels(offsetX: number, offsetY: number, color: string, opacity = 1) {
  const cells: { x: number; y: number }[] = []
  GRID.forEach((row, y) => {
    row.split('').forEach((c, x) => {
      if (c === '1') cells.push({ x, y })
    })
  })
  return cells.map(({ x, y }) => (
    <div
      key={`${color}-${x}-${y}`}
      style={{
        position: 'absolute',
        left: x * 4 + offsetX,
        top: y * 4 + offsetY,
        width: 4,
        height: 4,
        background: color,
        opacity,
      }}
    />
  ))
}

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: '#0a0a0f',
        }}
      >
        {/* RGB-сплит с рваным (не симметричным) сдвигом каналов по разным
            осям — так глитч читается на 32px, где ровный сдвиг сливается */}
        {pixels(-2, 1, '#ff2d55', 0.85)}
        {pixels(3, -1, '#2dd4ff', 0.85)}
        {pixels(0, 0, '#f5f5f5', 1)}
      </div>
    ),
    { ...size }
  )
}
