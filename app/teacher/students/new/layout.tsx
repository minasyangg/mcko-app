// Страница рядом — клиентский компонент и не может сама задать название
// вкладки, поэтому оно задаётся здесь.
export const metadata = { title: 'Новый ученик' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
