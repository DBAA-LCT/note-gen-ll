'use client'

import useSettingStore from '@/stores/setting'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import './chat.css'
import { advanceStreamingSmoother } from './streaming-smoother'
import { cn } from '@/lib/utils'
import { StreamdownRenderer } from '@/components/markdown/streamdown-renderer'

type ChatPreviewProps = {
  text: string
  streaming?: boolean
  containerClassName?: string
}

const MIN_RENDER_INTERVAL_MS = 33
const STREAM_BUFFER_CHARS = 2

export default function ChatPreview({ text, streaming = false, containerClassName }: ChatPreviewProps) {
  const { contentTextScale } = useSettingStore()
  const [displayedText, setDisplayedText] = useState('')
  const animationRef = useRef<number | null>(null)
  const displayedTextRef = useRef('')
  const targetTextRef = useRef('')
  const carryCharsRef = useRef(0)
  const lastFrameTimeRef = useRef<number | null>(null)
  const lastRenderTimeRef = useRef(0)
  const streamingRef = useRef(streaming)
  const hasStreamedRef = useRef(streaming)

  const renderDisplayedText = useCallback((nextText: string) => {
    displayedTextRef.current = nextText
    lastRenderTimeRef.current = performance.now()
    setDisplayedText(nextText)
  }, [])

  const stopAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
    lastFrameTimeRef.current = null
    carryCharsRef.current = 0
  }, [])

  const tickStreaming = useCallback((frameTime: number) => {
    if (frameTime - lastRenderTimeRef.current < MIN_RENDER_INTERVAL_MS) {
      animationRef.current = requestAnimationFrame(tickStreaming)
      return
    }

    const lastFrameTime = lastFrameTimeRef.current ?? frameTime
    const elapsedMs = frameTime - lastFrameTime
    lastFrameTimeRef.current = frameTime
    const targetLength = streamingRef.current
      ? Math.max(
          displayedTextRef.current.length,
          targetTextRef.current.length - STREAM_BUFFER_CHARS,
        )
      : targetTextRef.current.length

    const next = advanceStreamingSmoother(
      {
        carryChars: carryCharsRef.current,
        displayedLength: displayedTextRef.current.length,
      },
      targetLength,
      elapsedMs,
    )

    carryCharsRef.current = next.carryChars

    if (next.charsAdded > 0) {
      renderDisplayedText(targetTextRef.current.slice(0, next.displayedLength))
    }

    if (next.displayedLength >= targetLength) {
      animationRef.current = null
      lastFrameTimeRef.current = null
      carryCharsRef.current = 0
      if (!streamingRef.current && next.displayedLength >= targetTextRef.current.length) {
        hasStreamedRef.current = false
      }
      return
    }

    animationRef.current = requestAnimationFrame(tickStreaming)
  }, [renderDisplayedText])

  const ensureStreamingAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      return
    }
    lastFrameTimeRef.current = null
    animationRef.current = requestAnimationFrame(tickStreaming)
  }, [tickStreaming])

  useEffect(() => {
    streamingRef.current = streaming
    if (streaming) {
      hasStreamedRef.current = true
    }

    if (!streaming) {
      targetTextRef.current = text

      if (hasStreamedRef.current && text.length > displayedTextRef.current.length) {
        ensureStreamingAnimation()
      } else {
        stopAnimation()
        renderDisplayedText(text)
        hasStreamedRef.current = false
      }
      return
    }

    targetTextRef.current = text

    if (text.length < displayedTextRef.current.length) {
      stopAnimation()
      renderDisplayedText(text)
      return
    }

    if (text.length === displayedTextRef.current.length) {
      if (text !== displayedTextRef.current) {
        renderDisplayedText(text)
      }
      return
    }

    ensureStreamingAnimation()
  }, [text, streaming, ensureStreamingAnimation, renderDisplayedText, stopAnimation])

  useEffect(() => {
    return () => {
      stopAnimation()
    }
  }, [stopAnimation])

  if (!text.trim()) {
    return null
  }

  return (
    <div className={cn('flex-1 max-w-[calc(100vw-30px)] md:max-w-[calc(100vw-440px)]', containerClassName)}>
      <div
        className="w-full"
        style={{ fontSize: `${(16 * contentTextScale) / 100}px` }}
      >
        <StreamdownRenderer
          markdown={displayedText}
          streaming={streaming || (hasStreamedRef.current && displayedText.length < text.length)}
        />
      </div>
    </div>
  )
}
