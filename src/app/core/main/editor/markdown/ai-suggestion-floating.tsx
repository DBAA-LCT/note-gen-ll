'use client'

import { Editor } from '@tiptap/react'
import { Brain, Check, ChevronRight, CircleX, Loader2, Sparkles, X } from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import emitter from '@/lib/emitter'
import {
  setActiveAiSuggestionRequestId,
  setAiSuggestionShortcutVisible,
} from '@/lib/ai-suggestion-shortcut-state'
import { clearAiSuggestionHighlight, setAiSuggestionHighlight } from './ai-suggestion-highlight'

interface AISuggestionFloatingProps {
  editor: Editor
}

interface SuggestionData {
  requestId: string
  originalText: string
  suggestedText: string
  type: string
  startPosition: number
  generatedRange: { from: number; to: number }
  releaseEditorLock: () => void
}

interface PositionData {
  position: { top: number; left: number; right: number; bottom: number }
}

function getScrollContainer(editor: Editor) {
  const root = editor.view.dom.closest('.tiptap-editor')
  return root?.querySelector('.overflow-y-auto') as HTMLElement | null
}

function getEditorRoot(editor: Editor) {
  return editor.view.dom.closest('.tiptap-editor') as HTMLElement | null
}

function calculateFloatingPosition(
  editor: Editor,
  anchorPosition: { top: number; left: number; right: number; bottom: number },
  panelWidth: number,
  panelHeight: number,
) {
  const viewport = window.visualViewport
  const viewportLeft = viewport?.offsetLeft ?? 0
  const viewportTop = viewport?.offsetTop ?? 0
  const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth)
  const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
  const scrollContainer = getScrollContainer(editor)

  if (!scrollContainer) {
    const editorRoot = getEditorRoot(editor)

    if (!editorRoot) {
      return {
        top: Math.max(viewportTop + 12, Math.min(anchorPosition.bottom + 12, viewportBottom - panelHeight - 12)),
        left: Math.max(viewportLeft + 12, Math.min(anchorPosition.left - panelWidth / 2, viewportRight - panelWidth - 12)),
      }
    }

    const rootBounds = editorRoot.getBoundingClientRect()
    const visibleLeft = Math.max(rootBounds.left, viewportLeft)
    const visibleRight = Math.min(rootBounds.right, viewportRight)
    const visibleTop = Math.max(rootBounds.top, viewportTop)
    const visibleBottom = Math.min(rootBounds.bottom, viewportBottom)
    const preferredTop = anchorPosition.bottom + 12
    const fallbackTop = anchorPosition.top - panelHeight - 12
    const screenTop = preferredTop + panelHeight <= visibleBottom
      ? preferredTop
      : fallbackTop
    const centeredScreenLeft = visibleLeft + (visibleRight - visibleLeft - panelWidth) / 2

    return {
      top: Math.min(
        Math.max(screenTop, visibleTop + 12),
        Math.max(visibleTop + 12, visibleBottom - panelHeight - 12),
      ) - rootBounds.top,
      left: Math.min(
        Math.max(centeredScreenLeft, visibleLeft + 12),
        Math.max(visibleLeft + 12, visibleRight - panelWidth - 12),
      ) - rootBounds.left,
    }
  }

  const containerBounds = scrollContainer.getBoundingClientRect()
  const visibleLeft = Math.max(containerBounds.left, viewportLeft)
  const visibleRight = Math.min(containerBounds.right, viewportRight)
  const visibleTop = Math.max(containerBounds.top, viewportTop)
  const visibleBottom = Math.min(containerBounds.bottom, viewportBottom)
  const preferredScreenTop = anchorPosition.bottom + 12
  const fallbackScreenTop = anchorPosition.top - panelHeight - 12
  const screenTop = preferredScreenTop + panelHeight <= visibleBottom
    ? preferredScreenTop
    : fallbackScreenTop
  const centeredScreenLeft = visibleLeft + (visibleRight - visibleLeft - panelWidth) / 2
  const clampedScreenTop = Math.min(
    Math.max(screenTop, visibleTop + 12),
    Math.max(visibleTop + 12, visibleBottom - panelHeight - 12),
  )
  const clampedScreenLeft = Math.min(
    Math.max(centeredScreenLeft, visibleLeft + 12),
    Math.max(visibleLeft + 12, visibleRight - panelWidth - 12),
  )

  return {
    top: clampedScreenTop - containerBounds.top + scrollContainer.scrollTop,
    left: clampedScreenLeft - containerBounds.left + scrollContainer.scrollLeft,
  }
}

export function AISuggestionFloating({ editor }: AISuggestionFloatingProps) {
  const t = useTranslations('editor')
  const tCommon = useTranslations()
  const [suggestion, setSuggestion] = useState<SuggestionData | null>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [isVisible, setIsVisible] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [thinkingText, setThinkingText] = useState('')
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const thinkingContentRef = useRef<HTMLDivElement>(null)
  const latestSuggestionRef = useRef<SuggestionData | null>(null)
  const activeRequestIdRef = useRef<string | null>(null)
  const activeControllerRef = useRef<AbortController | null>(null)
  const anchorPositionRef = useRef<{ top: number; left: number; right: number; bottom: number } | null>(null)

  useEffect(() => {
    latestSuggestionRef.current = suggestion
  }, [suggestion])

  useEffect(() => {
    setAiSuggestionShortcutVisible(isVisible)

    return () => {
      setAiSuggestionShortcutVisible(false)
    }
  }, [isVisible])

  useEffect(() => {
    return () => {
      activeControllerRef.current?.abort()
      latestSuggestionRef.current?.releaseEditorLock()
      setActiveAiSuggestionRequestId(null)
    }
  }, [])

  useEffect(() => {
    return () => {
      clearAiSuggestionHighlight(editor)
    }
  }, [editor])

  const updatePosition = useCallback(() => {
    if (!anchorPositionRef.current) {
      return
    }

    const panelWidth = panelRef.current?.offsetWidth || 320
    const panelHeight = panelRef.current?.offsetHeight || (thinkingText ? 132 : 52)
    setPosition(calculateFloatingPosition(editor, anchorPositionRef.current, panelWidth, panelHeight))
  }, [editor, thinkingText])

  useEffect(() => {
    if (!isVisible) {
      return
    }

    updatePosition()
    const scrollContainer = getScrollContainer(editor)
    const visualViewport = window.visualViewport
    const handleLayoutChange = () => updatePosition()
    scrollContainer?.addEventListener('scroll', handleLayoutChange)
    visualViewport?.addEventListener('resize', handleLayoutChange)
    visualViewport?.addEventListener('scroll', handleLayoutChange)
    window.addEventListener('resize', handleLayoutChange)

    return () => {
      scrollContainer?.removeEventListener('scroll', handleLayoutChange)
      visualViewport?.removeEventListener('resize', handleLayoutChange)
      visualViewport?.removeEventListener('scroll', handleLayoutChange)
      window.removeEventListener('resize', handleLayoutChange)
    }
  }, [editor, isVisible, updatePosition])

  useEffect(() => {
    updatePosition()
  }, [thinkingText, isThinkingExpanded, isStreaming, suggestion?.suggestedText, updatePosition])

  useEffect(() => {
    if (isStreaming && thinkingText) {
      setIsThinkingExpanded(true)
    }
  }, [isStreaming, thinkingText])

  useEffect(() => {
    if (!isStreaming || !isThinkingExpanded || !thinkingContentRef.current) {
      return
    }

    thinkingContentRef.current.scrollTop = thinkingContentRef.current.scrollHeight
  }, [isStreaming, isThinkingExpanded, thinkingText])

  useEffect(() => {
    if (!editor) return

    const handleStartStreaming = (data: {
      requestId: string
      originalText: string
      type: string
      startPosition: number
      position: { top: number; left: number; right: number; bottom: number }
      generatedRange: { from: number; to: number }
      controller: AbortController
      releaseEditorLock: () => void
    }) => {
      if (activeRequestIdRef.current && activeRequestIdRef.current !== data.requestId) {
        activeControllerRef.current?.abort()
        latestSuggestionRef.current?.releaseEditorLock()
      }

      activeRequestIdRef.current = data.requestId
      activeControllerRef.current = data.controller
      setActiveAiSuggestionRequestId(data.requestId)
      clearAiSuggestionHighlight(editor)
      anchorPositionRef.current = data.position
      setSuggestion({
        requestId: data.requestId,
        originalText: data.originalText,
        suggestedText: '',
        type: data.type,
        startPosition: data.startPosition,
        generatedRange: data.generatedRange,
        releaseEditorLock: data.releaseEditorLock,
      })
      setThinkingText('')
      setIsThinkingExpanded(false)
      setIsVisible(true)
      setIsStreaming(true)
    }

    const handleUpdateThinkingContent = (data: {
      requestId: string
      thinkingText: string
      position: { top: number; left: number; right: number; bottom: number }
      generatedRange: { from: number; to: number }
    }) => {
      if (activeRequestIdRef.current !== data.requestId) return
      anchorPositionRef.current = anchorPositionRef.current || data.position
      setThinkingText(data.thinkingText)
      setSuggestion(prev => prev?.requestId === data.requestId ? {
        ...prev,
        generatedRange: data.generatedRange,
      } : prev)
    }

    const handleUpdateContent = (data: {
      requestId: string
      suggestedText: string
      position: { top: number; left: number; right: number; bottom: number }
      generatedRange: { from: number; to: number }
    }) => {
      if (activeRequestIdRef.current !== data.requestId) return
      anchorPositionRef.current = anchorPositionRef.current
        ? {
            ...anchorPositionRef.current,
            top: data.position.top,
            bottom: data.position.bottom,
          }
        : data.position

      if (data.suggestedText) {
        setIsThinkingExpanded(false)
      }
      setSuggestion(prev => prev?.requestId === data.requestId ? {
        ...prev,
        suggestedText: data.suggestedText,
        generatedRange: data.generatedRange,
      } : prev)
    }

    const handleStreamingComplete = (data: (SuggestionData & PositionData) | { requestId: string }) => {
      if (activeRequestIdRef.current !== data.requestId) return

      activeControllerRef.current = null
      setIsStreaming(false)
      if ('originalText' in data) {
        anchorPositionRef.current = data.position
        setAiSuggestionHighlight(editor, data.generatedRange)
        setSuggestion(data)
        setIsVisible(true)
      } else {
        latestSuggestionRef.current?.releaseEditorLock()
        activeRequestIdRef.current = null
        setActiveAiSuggestionRequestId(null)
        clearAiSuggestionHighlight(editor)
        anchorPositionRef.current = null
        setThinkingText('')
        setIsVisible(false)
        setSuggestion(null)
      }
    }

    const handleAbortStreaming = (data: { requestId: string | null }) => {
      const activeRequestId = activeRequestIdRef.current
      if (!activeRequestId || (data.requestId !== null && data.requestId !== activeRequestId)) return

      activeControllerRef.current?.abort()
      latestSuggestionRef.current?.releaseEditorLock()
      activeControllerRef.current = null
      activeRequestIdRef.current = null
      setActiveAiSuggestionRequestId(null)
      setIsStreaming(false)
      clearAiSuggestionHighlight(editor)
      anchorPositionRef.current = null
      setThinkingText('')
      setIsVisible(false)
      setSuggestion(null)
    }

    const handleShowSuggestion = (data: SuggestionData & PositionData) => {
      if (activeControllerRef.current && activeRequestIdRef.current !== data.requestId) return
      if (activeRequestIdRef.current && activeRequestIdRef.current !== data.requestId) {
        latestSuggestionRef.current?.releaseEditorLock()
      }

      activeRequestIdRef.current = data.requestId
      activeControllerRef.current = null
      setActiveAiSuggestionRequestId(data.requestId)
      anchorPositionRef.current = data.position
      setAiSuggestionHighlight(editor, data.generatedRange)
      setSuggestion(data)
      setIsVisible(true)
      setIsStreaming(false)
    }

    emitter.on('start-ai-streaming', handleStartStreaming)
    emitter.on('update-ai-thinking-content', handleUpdateThinkingContent)
    emitter.on('update-ai-streaming-content', handleUpdateContent)
    emitter.on('ai-streaming-complete', handleStreamingComplete)
    emitter.on('show-ai-suggestion', handleShowSuggestion)
    emitter.on('abort-ai-streaming', handleAbortStreaming)

    return () => {
      emitter.off('start-ai-streaming', handleStartStreaming)
      emitter.off('update-ai-thinking-content', handleUpdateThinkingContent)
      emitter.off('update-ai-streaming-content', handleUpdateContent)
      emitter.off('ai-streaming-complete', handleStreamingComplete)
      emitter.off('show-ai-suggestion', handleShowSuggestion)
      emitter.off('abort-ai-streaming', handleAbortStreaming)
    }
  }, [editor])

  const dismissSuggestion = useCallback(() => {
    activeRequestIdRef.current = null
    activeControllerRef.current = null
    setActiveAiSuggestionRequestId(null)
    anchorPositionRef.current = null
    setThinkingText('')
    setIsVisible(false)
    setSuggestion(null)
  }, [])

  const handleAccept = useCallback(() => {
    latestSuggestionRef.current?.releaseEditorLock()
    clearAiSuggestionHighlight(editor)
    dismissSuggestion()
  }, [dismissSuggestion, editor])

  const handleReject = useCallback(() => {
    const current = latestSuggestionRef.current
    if (!current || activeRequestIdRef.current !== current.requestId) return

    clearAiSuggestionHighlight(editor)
    current.releaseEditorLock()
    const docSize = editor.state.doc.content.size
    const clampedFrom = Math.max(0, Math.min(current.generatedRange.from, docSize))
    const clampedTo = Math.max(0, Math.min(current.generatedRange.to, docSize))
    const generatedRange = {
      from: Math.min(clampedFrom, clampedTo),
      to: Math.max(clampedFrom, clampedTo),
    }

    if (generatedRange.from < generatedRange.to) {
      editor.chain().focus().deleteRange(generatedRange).run()
    }
    if (current.originalText) {
      const startPosition = Math.max(0, Math.min(current.startPosition, editor.state.doc.content.size))
      editor.chain().focus().insertContentAt(startPosition, current.originalText).run()
    }

    dismissSuggestion()
  }, [dismissSuggestion, editor])

  const handleAbort = useCallback(() => {
    emitter.emit('abort-ai-streaming', { requestId: activeRequestIdRef.current })
  }, [])

  useEffect(() => {
    if (!isVisible || isStreaming) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) {
        return
      }

      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        handleAccept()
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        handleReject()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [handleAccept, handleReject, isStreaming, isVisible])

  useEffect(() => {
    emitter.on('accept-ai-suggestion', handleAccept)
    emitter.on('reject-ai-suggestion', handleReject)

    return () => {
      emitter.off('accept-ai-suggestion', handleAccept)
      emitter.off('reject-ai-suggestion', handleReject)
    }
  }, [handleAccept, handleReject])

  if (!isVisible) return null

  const typeLabels: Record<string, string> = {
    polish: t('bubbleMenu.polish'),
    concise: t('bubbleMenu.concise'),
    expand: t('bubbleMenu.expand'),
    translate: t('bubbleMenu.translate'),
    continue: t('slashCommand.items.continue'),
    section: t('slashCommand.items.generateSection'),
    summary: t('slashCommand.items.summarize'),
    custom: t('slashCommand.items.customInstruction'),
  }

  const showThinkingPanel = Boolean(thinkingText)
  const currentLabel = suggestion && typeLabels[suggestion.type] ? typeLabels[suggestion.type] : t('bubbleMenu.ai')
  const rejectLabel = suggestion?.originalText ? t('aiSuggestion.reject') : t('aiSuggestion.undo')

  return (
    <div
      ref={panelRef}
      className="absolute z-50 max-h-[min(20rem,calc(var(--mobile-viewport-height,100vh)-1.5rem))] w-[320px] max-w-[calc(100%-24px)] overflow-y-auto overscroll-contain rounded-xl border border-border/60 bg-background/96 text-foreground shadow-2xl backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-150"
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      {showThinkingPanel && (
        <div className="border-b border-border/60">
          <button
            type="button"
            onClick={() => setIsThinkingExpanded(prev => !prev)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
          >
            {isStreaming ? (
              <Loader2 className="size-4 animate-spin text-blue-500" />
            ) : (
              <Brain className="size-4 text-blue-500" />
            )}
            <span className="flex-1 text-sm text-muted-foreground">
              {tCommon('ai.thinking')}
            </span>
            <ChevronRight className={`size-4 text-muted-foreground transition-transform ${isThinkingExpanded ? 'rotate-90' : ''}`} />
          </button>

          {isThinkingExpanded && (
            <div
              ref={thinkingContentRef}
              className="max-h-36 overflow-y-auto px-3 pb-3 text-xs leading-5 text-muted-foreground whitespace-pre-wrap break-words"
            >
              {thinkingText}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2.5">
        {isStreaming ? (
          <Loader2 className="size-4 animate-spin text-primary" />
        ) : (
          <Sparkles className="size-4 text-primary" />
        )}
        <span className="flex-1 text-sm font-medium">
          {isStreaming ? t('aiSuggestion.generating') : currentLabel}
        </span>
        {isStreaming ? (
          <button
            onClick={handleAbort}
            className="rounded-md p-1 transition-colors hover:bg-muted"
            title={t('aiSuggestion.abort')}
            type="button"
          >
            <CircleX className="size-4" />
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={handleAccept}
              className="rounded-md p-1 transition-colors hover:bg-muted"
              title={t('aiSuggestion.accept')}
              type="button"
            >
              <Check className="size-4" />
            </button>
            <button
              onClick={handleReject}
              className="rounded-md p-1 transition-colors hover:bg-muted"
              title={rejectLabel}
              type="button"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default AISuggestionFloating
