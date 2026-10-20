// Классы ленты табов с подчёркиванием (Мониторинг, Мои задания, Пользователи…).
// На десктопе — как раньше. На телефоне табы не помещались в ширину экрана и
// переносились/обрезались, поэтому там лента прокручивается вбок и выходит
// к краям экрана (-mx-4 компенсирует отступ <main>). -mb-px на телефоне
// снят: у прокручиваемого контейнера он обрезал бы нижний пиксель подчёркивания.
export const tabBarClass =
  'flex gap-1 border-b max-md:-mx-4 max-md:px-4 max-md:overflow-x-auto max-md:overflow-y-hidden max-md:scrollbar-none'

export const tabButtonClass =
  'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors max-md:mb-0 max-md:shrink-0 max-md:whitespace-nowrap max-md:px-3 max-md:py-2.5'
