/* Куда вернуть человека после входа, если его прислали с параметром next.
   Пускаем только внутренние пути: «//» и «/\» браузер считает адресом другого
   сайта, а табуляцию и перевод строки внутри адреса молча выбрасывает
   («/<tab>/evil.example» превращается в «//evil.example»). Без этой проверки
   ссылка на вход стала бы открытым редиректом. Пусто или чужое — null,
   вызывающий код ведёт себя так, будто параметра не было. */
export function safeNext(raw: string | null): string | null {
  if (!raw) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null
  return raw
}
