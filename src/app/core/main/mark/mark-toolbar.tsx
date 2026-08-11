'use client'

import { useTranslations } from 'next-intl'
import useMarkStore from "@/stores/mark"

export function MarkToolbar() {
  const { 
    marks, 
    visibleMarkIds,
    isMultiSelectMode, 
    selectedMarkIds, 
  } = useMarkStore()
  const t = useTranslations('record.mark.toolbar')

  const visibleCount = visibleMarkIds.length > 0 ? visibleMarkIds.length : marks.length

  if (marks.length === 0) {
    return null
  }

  return (
    <div className="flex h-6 items-center overflow-hidden border-t border-border bg-background px-2 text-xs text-muted-foreground">
      {isMultiSelectMode ? (
        <span>{t('selectedCount', { count: selectedMarkIds.size })}</span>
      ) : (
        <span>{t('visibleCount', { count: visibleCount })}</span>
      )}
    </div>
  )
}
