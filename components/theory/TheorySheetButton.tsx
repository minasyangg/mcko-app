'use client'

import { useState } from 'react'
import { ArrowLeft, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { TheoryBlock } from '@/lib/theory/types'
import { TheoryBlocksView } from './TheoryBlocksView'

// Кнопка «Теория» в шапке плеера: открывает выжимку в боковой панели поверх
// задания — ответы и позиция в тесте при этом не теряются.
//
// На телефоне панель на весь экран (по умолчанию Sheet занимает 3/4 ширины —
// узкая колонка с формулами и таблицами читается плохо). Прокручивается
// только текст: шапка с крестиком закреплена — иначе на длинной теории
// крестик уезжал вверх вместе с содержимым. Внизу на телефоне — кнопка
// возврата к заданию под большой палец.
export function TheorySheetButton({ blocks }: { blocks: TheoryBlock[] }) {
  const [open, setOpen] = useState(false)
  if (blocks.length === 0) return null

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 shrink-0"
        onClick={() => setOpen(true)}
        title="Открыть теорию к уроку"
      >
        <BookOpen className="h-3.5 w-3.5" />
        <span className="ml-1.5 hidden sm:inline">Теория</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
          <SheetHeader className="shrink-0 border-b pb-3 pr-12">
            <SheetTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-sky-600" />
              Теория к уроку
            </SheetTitle>
            <SheetDescription>Ответы сохраняются — закройте панель и продолжайте решать.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" data-theory-scroll>
            <TheoryBlocksView blocks={blocks} />
          </div>
          <div className="shrink-0 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden">
            <Button className="w-full" variant="outline" onClick={() => setOpen(false)}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Вернуться к заданию
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
