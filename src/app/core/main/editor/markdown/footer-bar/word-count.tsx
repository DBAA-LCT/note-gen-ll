'use client'

import { Editor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  getEditorStatistics,
  markdownToPlainText,
  type EditorStatistics,
} from '@/lib/editor-statistics'

interface WordCountProps {
  editor: Editor
  sourceMarkdown?: string
  compact?: boolean
}

export function WordCount({ editor, sourceMarkdown, compact = false }: WordCountProps) {
  const t = useTranslations('settings.editor.stats')
  const getCurrentStatistics = () => getEditorStatistics(
    sourceMarkdown === undefined
      ? editor.state.doc.textContent
      : markdownToPlainText(sourceMarkdown)
  )
  const [statistics, setStatistics] = useState<EditorStatistics>(getCurrentStatistics)

  useEffect(() => {
    if (sourceMarkdown !== undefined) {
      setStatistics(getEditorStatistics(markdownToPlainText(sourceMarkdown)))
      return
    }

    let updateTimer: ReturnType<typeof setTimeout> | null = null

    const updateCharacters = () => {
      if (updateTimer) {
        clearTimeout(updateTimer)
      }

      updateTimer = setTimeout(() => {
        updateTimer = null
        setStatistics(getEditorStatistics(editor.state.doc.textContent))
      }, 400)
    }

    setStatistics(getEditorStatistics(editor.state.doc.textContent))
    editor.on('create', updateCharacters)
    editor.on('update', updateCharacters)

    return () => {
      if (updateTimer) {
        clearTimeout(updateTimer)
      }
      editor.off('create', updateCharacters)
      editor.off('update', updateCharacters)
    }
  }, [editor, sourceMarkdown])

  if (compact) {
    return <span className="text-xs">{t('characters', { count: statistics.characters })}</span>
  }

  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span>{t('characters', { count: statistics.characters })}</span>
      <span aria-hidden="true">·</span>
      <span>{t('readingTime', { count: statistics.readingMinutes })}</span>
    </span>
  )
}
