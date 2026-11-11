import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Страницы кабинета нельзя встраивать в чужой iframe (кликджекинг).
          // Сам сайт себя во фреймы не кладёт, печать идёт через window.open.
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          // Браузер не угадывает тип ответа по содержимому
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // На чужие сайты уходит только домен, без пути и параметров
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
};

export default nextConfig;
