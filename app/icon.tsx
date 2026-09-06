import { ImageResponse } from 'next/og'

// Иконка вкладки браузера. Next.js App Router рендерит этот файл в PNG на
// лету и сам подставляет нужные <link rel="icon"> — ручной favicon.ico не
// нужен. Тема — школьная «пятёрка с плюсом»: узнаваемый мем для любого, кто
// сдавал контрольные, и по делу для платформы тестов/ДЗ.
export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#dc2626',
          borderRadius: 7,
          fontSize: 22,
          fontWeight: 700,
          color: 'white',
          fontFamily: 'Georgia, serif',
        }}
      >
        5+
      </div>
    ),
    { ...size }
  )
}
