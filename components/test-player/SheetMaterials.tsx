'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ExternalLink, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SheetMaterialItem {
  id: string
  name: string
  url: string
}

// Файлы работы бланка ответов по PDF (миграция 116). На планшете и шире —
// встроенный просмотр выбранного файла; на телефоне встроенный PDF почти не
// листается, поэтому там только кнопки «Открыть» (в новой вкладке откроется
// системный просмотрщик).
export function SheetMaterials({ materials, preview = true }: { materials: SheetMaterialItem[]; preview?: boolean }) {
  const [activeId, setActiveId] = useState(materials[0]?.id ?? null)
  const active = materials.find(m => m.id === activeId) ?? materials[0]

  if (materials.length === 0) {
    return <p className="text-sm text-muted-foreground">Файлы работы недоступны — обратитесь к учителю.</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {materials.map(m => (
          <div key={m.id} className="flex items-center gap-1 min-w-0 max-w-full">
            {/* выбор файла для встроенного просмотра — только когда их несколько */}
            {preview && materials.length > 1 && (
              <button
                type="button"
                onClick={() => setActiveId(m.id)}
                className={cn(
                  'hidden md:flex items-center gap-1.5 rounded-md border px-2.5 h-8 text-sm min-w-0',
                  m.id === active?.id ? 'bg-muted font-medium' : 'hover:bg-muted/50',
                )}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{m.name}</span>
              </button>
            )}
            {/* «Открыть» есть всегда: на телефоне это единственный способ
                посмотреть файл, на компьютере — запасной, если встроенный
                просмотр не отрисовался */}
            <Button asChild variant="outline" size="sm" className="min-w-0">
              <a href={m.url} target="_blank" rel="noopener noreferrer" title={`Открыть «${m.name}» в новой вкладке`}>
                {preview && materials.length > 1 ? (
                  // на телефоне вкладок выбора нет — там нужно имя файла
                  <>
                    <span className="truncate md:hidden mr-1.5">{m.name}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </>
                ) : (
                  <>
                    <FileText className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                    <span className="truncate">{m.name}</span>
                    <ExternalLink className="h-3 w-3 ml-1.5 shrink-0 opacity-60" />
                  </>
                )}
              </a>
            </Button>
          </div>
        ))}
      </div>
      {preview && active && (
        <iframe
          key={active.id}
          src={active.url}
          title={active.name}
          className="hidden md:block w-full h-[70vh] rounded-md border bg-muted/30"
        />
      )}
    </div>
  )
}
