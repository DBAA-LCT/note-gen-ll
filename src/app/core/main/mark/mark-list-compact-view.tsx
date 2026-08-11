'use client'

import type { Mark } from "@/db/marks"
import { cn } from "@/lib/utils"
import { MarkItem } from "./mark-item"

export function MarkListCompactView({ marks, grouped = false }: { marks: Mark[], grouped?: boolean }) {
  return (
    <div className={cn(
      "flex w-full min-w-0 max-w-full flex-col overflow-hidden",
      grouped ? "gap-1 px-1.5 py-1.5" : "gap-1.5 px-2 py-2"
    )}>
      {marks.map((mark) => (
        <MarkItem key={mark.id} mark={mark} variant="compact" grouped={grouped} />
      ))}
    </div>
  )
}
