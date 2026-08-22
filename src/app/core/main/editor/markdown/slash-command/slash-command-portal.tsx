'use client'

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Editor } from '@tiptap/react'
import { useTranslations } from 'next-intl'
import { SendHorizontal } from 'lucide-react'
import { SlashMenu, SlashMenuRef } from './slash-menu'
import { setMenuKeyDownHandler } from './index'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface MenuState {
  visible: boolean
  editor: Editor | null
  clientRect: DOMRect | null
  query: string
}

interface MenuPosition {
  top: number
  left: number
  maxHeight: number
}

interface CustomPromptState {
  visible: boolean
  clientRect: DOMRect | null
  position: MenuPosition | null
  value: string
}

// Menu dimensions
const MENU_MAX_HEIGHT = 288
const MENU_MIN_HEIGHT = 96
const MENU_WIDTH = 416
const CUSTOM_PROMPT_HEIGHT = 64
const MARGIN = 8

function getVisualViewportBounds() {
  const viewport = window.visualViewport
  const left = viewport?.offsetLeft ?? 0
  const top = viewport?.offsetTop ?? 0
  const width = viewport?.width ?? window.innerWidth
  const height = viewport?.height ?? window.innerHeight

  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  }
}

function calculateMenuPosition(
  clientRect: DOMRect,
  desiredHeight = MENU_MAX_HEIGHT,
): MenuPosition {
  const viewport = getVisualViewportBounds()
  const menuWidth = Math.min(MENU_WIDTH, Math.max(0, viewport.width - MARGIN * 2))
  const availableHeightBelow = Math.max(0, viewport.bottom - clientRect.bottom - MARGIN)
  const availableHeightAbove = Math.max(0, clientRect.top - viewport.top - MARGIN)
  const showAbove = availableHeightBelow < desiredHeight && availableHeightAbove > availableHeightBelow
  const availableHeight = showAbove ? availableHeightAbove : availableHeightBelow
  const viewportUsableHeight = Math.max(0, viewport.height - MARGIN * 2)
  const minimumHeight = Math.min(MENU_MIN_HEIGHT, desiredHeight, viewportUsableHeight)
  const maxHeight = Math.min(
    desiredHeight,
    viewportUsableHeight,
    Math.max(minimumHeight, availableHeight),
  )

  const preferredTop = showAbove
    ? clientRect.top - maxHeight - MARGIN
    : clientRect.bottom + MARGIN
  const top = Math.min(
    Math.max(preferredTop, viewport.top + MARGIN),
    Math.max(viewport.top + MARGIN, viewport.bottom - maxHeight - MARGIN),
  )
  const left = Math.min(
    Math.max(clientRect.left, viewport.left + MARGIN),
    Math.max(viewport.left + MARGIN, viewport.right - menuWidth - MARGIN),
  )

  return { top, left, maxHeight }
}

export const SlashCommandPortal = () => {
  const t = useTranslations('editor.slashCommand.customPrompt')
  const [state, setState] = useState<MenuState>({
    visible: false,
    editor: null,
    clientRect: null,
    query: '',
  })
  const [customPrompt, setCustomPrompt] = useState<CustomPromptState>({
    visible: false,
    clientRect: null,
    position: null,
    value: '',
  })
  const menuRef = useRef<SlashMenuRef>(null)
  const customPromptRef = useRef<HTMLFormElement>(null)
  const customPromptInputRef = useRef<HTMLInputElement>(null)
  const [position, setPosition] = useState<MenuPosition | null>(null)

  const hideMenu = useCallback(() => {
    setState((prev) => ({ ...prev, visible: false }))
    setPosition(null)
  }, [])

  const hideCustomPrompt = useCallback(() => {
    setCustomPrompt({
      visible: false,
      clientRect: null,
      position: null,
      value: '',
    })
  }, [])

  useEffect(() => {
    const showHandler = (e: Event) => {
      const event = e as CustomEvent<{
        editor: Editor
        clientRect: DOMRect
        query: string
      }>
      const newPosition = calculateMenuPosition(event.detail.clientRect)
      setPosition(newPosition)
      setState({
        visible: true,
        editor: event.detail.editor,
        clientRect: event.detail.clientRect,
        query: event.detail.query,
      })
    }

    const updateHandler = (e: Event) => {
      const event = e as CustomEvent<{
        clientRect: DOMRect
        query: string
      }>
      setPosition(calculateMenuPosition(event.detail.clientRect))
      setState((prev) => ({
        ...prev,
        clientRect: event.detail.clientRect,
        query: event.detail.query,
      }))
    }

    const hideHandler = () => {
      hideMenu()
    }

    const showCustomPromptHandler = (e: Event) => {
      const event = e as CustomEvent<{
        clientRect: DOMRect
      }>
      setCustomPrompt({
        visible: true,
        clientRect: event.detail.clientRect,
        position: calculateMenuPosition(event.detail.clientRect, CUSTOM_PROMPT_HEIGHT),
        value: '',
      })
      hideMenu()
    }

    document.addEventListener('slash-command-show', showHandler)
    document.addEventListener('slash-command-update', updateHandler)
    document.addEventListener('slash-command-hide', hideHandler)
    document.addEventListener('tiptap-ai-custom-instruction-open', showCustomPromptHandler)

    return () => {
      document.removeEventListener('slash-command-show', showHandler)
      document.removeEventListener('slash-command-update', updateHandler)
      document.removeEventListener('slash-command-hide', hideHandler)
      document.removeEventListener('tiptap-ai-custom-instruction-open', showCustomPromptHandler)
    }
  }, [hideMenu])

  useEffect(() => {
    if (!state.visible && !customPrompt.visible) {
      return
    }

    const handleViewportChange = () => {
      if (state.visible && state.clientRect) {
        setPosition(calculateMenuPosition(state.clientRect))
      }
      if (customPrompt.visible && customPrompt.clientRect) {
        const nextPosition = calculateMenuPosition(customPrompt.clientRect, CUSTOM_PROMPT_HEIGHT)
        setCustomPrompt((prev) => ({ ...prev, position: nextPosition }))
      }
    }
    const visualViewport = window.visualViewport

    visualViewport?.addEventListener('resize', handleViewportChange)
    visualViewport?.addEventListener('scroll', handleViewportChange)
    window.addEventListener('resize', handleViewportChange)

    return () => {
      visualViewport?.removeEventListener('resize', handleViewportChange)
      visualViewport?.removeEventListener('scroll', handleViewportChange)
      window.removeEventListener('resize', handleViewportChange)
    }
  }, [customPrompt.clientRect, customPrompt.visible, state.clientRect, state.visible])

  useEffect(() => {
    if (!customPrompt.visible) {
      return
    }

    const animationFrame = requestAnimationFrame(() => {
      customPromptInputRef.current?.focus()
    })

    return () => cancelAnimationFrame(animationFrame)
  }, [customPrompt.visible])

  useEffect(() => {
    if (!customPrompt.visible) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (customPromptRef.current?.contains(event.target as Node)) {
        return
      }
      hideCustomPrompt()
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [customPrompt.visible, hideCustomPrompt])

  // Register keyDown handler when menu becomes visible
  useEffect(() => {
    if (state.visible && menuRef.current) {
      const handler = (props: { event: KeyboardEvent }) => {
        return menuRef.current?.onKeyDown?.(props) ?? false
      }
      setMenuKeyDownHandler(handler)

      return () => {
        setMenuKeyDownHandler(null)
      }
    }
  }, [state.visible])

  const handleCustomPromptSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const instruction = customPrompt.value.trim()
    if (!instruction) {
      return
    }

    document.dispatchEvent(new CustomEvent('tiptap-ai-generate', {
      detail: {
        action: 'custom',
        instruction,
      },
    }))
    hideCustomPrompt()
  }, [customPrompt.value, hideCustomPrompt])

  const handleCustomPromptKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      hideCustomPrompt()
    }
  }, [hideCustomPrompt])

  const slashMenuContext = state.visible && state.editor && state.clientRect && position
    ? {
        editor: state.editor,
        clientRect: state.clientRect,
        position,
      }
    : null
  const customPromptPosition = customPrompt.visible ? customPrompt.position : null

  if (!slashMenuContext && !customPromptPosition) return null

  return (
    <>
      {slashMenuContext && (
        <div
          style={{
            position: 'fixed',
            top: slashMenuContext.position.top,
            left: slashMenuContext.position.left,
            zIndex: 9999,
          }}
        >
          <SlashMenu
            ref={menuRef}
            editor={slashMenuContext.editor}
            clientRect={slashMenuContext.clientRect}
            query={state.query}
            maxHeight={slashMenuContext.position.maxHeight}
          />
        </div>
      )}
      {customPromptPosition && (
        <div
          style={{
            position: 'fixed',
            top: customPromptPosition.top,
            left: customPromptPosition.left,
            zIndex: 9999,
          }}
        >
          <form
            ref={customPromptRef}
            className="flex w-[min(26rem,calc(100vw-1rem))] items-center gap-2 rounded-lg border border-border bg-background/95 p-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/60"
            onSubmit={handleCustomPromptSubmit}
          >
            <Input
              ref={customPromptInputRef}
              aria-label={t('ariaLabel')}
              className="h-8"
              placeholder={t('placeholder')}
              value={customPrompt.value}
              onChange={(event) => setCustomPrompt((prev) => ({ ...prev, value: event.target.value }))}
              onKeyDown={handleCustomPromptKeyDown}
            />
            <Button
              type="submit"
              size="sm"
              disabled={!customPrompt.value.trim()}
            >
              <SendHorizontal data-icon="inline-start" />
              {t('submit')}
            </Button>
          </form>
        </div>
      )}
    </>
  )
}

SlashCommandPortal.displayName = 'SlashCommandPortal'

export default SlashCommandPortal
