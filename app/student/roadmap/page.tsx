import { redirect } from 'next/navigation'

// «Программа» переехала во вкладку на главной странице кабинета (см.
// app/student/page.tsx + components/student/StudentHome.tsx) — весь список
// назначений теперь в одном месте, а не разнесён по разделам. Путь оставлен
// редиректом ради уже отправленных ссылок (например, backHref в
// app/student/attempt/[id]/page.tsx мог быть сохранён в закладке/истории).
export default function StudentRoadmapRedirect() {
  redirect('/student?tab=roadmap')
}
