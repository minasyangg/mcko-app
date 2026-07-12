// Реестр событий модуля уведомлений. Каждое событие можно включить/выключить
// в админ-панели по каналу; отсутствие настройки = включено по умолчанию.
// Каналы: telegram (реализован), email (будущий — та же модель настроек).

export type NotificationChannel = 'telegram' | 'email'

export type NotificationEventType =
  | 'assignment_created'  // ученику: назначен тест/ДЗ
  | 'attempt_checked'     // ученику: работа проверена (есть результат)
  | 'attempt_submitted'   // учителю: работа ждёт ручной проверки

export const NOTIFICATION_EVENTS: {
  type: NotificationEventType
  audience: 'student' | 'teacher'
  title: string
  description: string
}[] = [
  {
    type: 'assignment_created',
    audience: 'student',
    title: 'Назначен тест / домашнее задание',
    description: 'Ученик получает сообщение, когда ему или его группе назначают тест или ДЗ.',
  },
  {
    type: 'attempt_checked',
    audience: 'student',
    title: 'Работа проверена',
    description: 'Ученик получает сообщение с баллом, когда его попытка проверена (автоматически или учителем).',
  },
  {
    type: 'attempt_submitted',
    audience: 'teacher',
    title: 'Работа ждёт проверки',
    description: 'Учитель, назначивший тест, получает сообщение, когда ученик сдал работу, требующую ручной проверки.',
  },
]
