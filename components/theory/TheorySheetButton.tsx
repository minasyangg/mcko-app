'use client'

import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { TheoryBlock } from '@/lib/theory/types'
import { TheoryBlocksView } from './TheoryBlocksView'

// Кнопка «Теория» в шапке плеера: открывает выжимку в боковой панели поверх
// задания — ответы и позиция в тесте при этом не теряются.
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
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="border-b pb-3">
            <SheetTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-sky-600" />
              Теория к уроку
            </SheetTitle>
            <SheetDescription>Ответы сохраняются — закройте панель и продолжайте решать.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            <TheoryBlocksView blocks={blocks} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
