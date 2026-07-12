import { redirect } from 'next/navigation'

// Назначения переехали в «Мониторинг» (первый таб). Форма создания
// осталась по адресу /teacher/assignments/new.
export default function AssignmentsPage() {
  redirect('/teacher/monitor')
}
