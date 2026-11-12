// Ошибки Supabase Auth приходят по-английски («Invalid login credentials») —
// школьнику и родителю такое сообщение ничего не говорит. Сопоставляем по
// коду ошибки, а где его нет — по тексту; незнакомую ошибку не показываем
// как есть, а даём общую формулировку.
interface AuthErrorLike {
  message?: string
  code?: string
  status?: number
}

const BY_CODE: Record<string, string> = {
  invalid_credentials: 'Неверный email или пароль',
  email_not_confirmed: 'Email не подтверждён. Проверьте почту и перейдите по ссылке из письма.',
  user_banned: 'Аккаунт заблокирован. Обратитесь к администратору.',
  over_request_rate_limit: 'Слишком много попыток. Подождите минуту и попробуйте снова.',
  over_email_send_rate_limit: 'Слишком много писем за короткое время. Попробуйте позже.',
  user_already_exists: 'Пользователь с таким email уже зарегистрирован',
  email_exists: 'Пользователь с таким email уже зарегистрирован',
  weak_password: 'Пароль слишком простой. Придумайте пароль длиннее.',
  signup_disabled: 'Регистрация сейчас закрыта. Обратитесь к администратору.',
  email_address_invalid: 'Некорректный email',
  validation_failed: 'Проверьте правильность введённых данных',
}

const BY_TEXT: [RegExp, string][] = [
  [/invalid login credentials/i, BY_CODE.invalid_credentials],
  [/email not confirmed/i, BY_CODE.email_not_confirmed],
  [/already registered|already exists/i, BY_CODE.user_already_exists],
  [/rate limit|too many requests/i, BY_CODE.over_request_rate_limit],
  [/password should be at least/i, BY_CODE.weak_password],
  // так signUp отвечает, когда отказал триггер уникальности ника (миграция 097)
  [/database error saving new user/i, 'Не удалось создать аккаунт. Возможно, этот ник Telegram уже указан в другом аккаунте.'],
  [/failed to fetch|network|load failed/i, 'Нет связи с сервером. Проверьте интернет и попробуйте снова.'],
]

export function authErrorMessage(error: AuthErrorLike, fallback: string): string {
  if (error.code && BY_CODE[error.code]) return BY_CODE[error.code]
  if (error.status === 429) return BY_CODE.over_request_rate_limit
  const text = error.message ?? ''
  for (const [pattern, message] of BY_TEXT) if (pattern.test(text)) return message
  return fallback
}
