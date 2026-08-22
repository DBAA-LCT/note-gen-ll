'use client'

import useArticleStore from '@/stores/article'
import { useEffect, useState, useCallback, useRef, RefObject } from 'react'
import { TipTapEditor } from './tiptap-editor'
import { Outline } from './outline'
import { Archive, Download, Loader2, LockKeyhole } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'
import emitter from '@/lib/emitter'
import { getActiveAiSuggestionRequestId } from '@/lib/ai-suggestion-shortcut-state'
import {
  DEFAULT_OUTLINE_WIDTH,
  normalizeOutlineWidth,
  OUTLINE_WIDTH_STORE_KEY,
} from '@/lib/outline-preferences'
import { Store } from '@tauri-apps/plugin-store'
import { useShallow } from 'zustand/react/shallow'
import useSettingStore from '@/stores/setting'
import { getDailyReportDateFromPath, isLearningReportMarkdown, removeLearningReportMarkdown } from '@/lib/learning/report'
import useLearningStore from '@/stores/learning'

interface MdEditorProps {
  tabContentsRef: RefObject<Record<string, string>>
  filePath: string
  isActive: boolean
}

export function MdEditor({ tabContentsRef, filePath, isActive }: MdEditorProps) {
  const {
    saveCurrentArticle,
    isPulling,
    setCurrentArticle,
    activeFilePath,
    currentArticle,
    justPulledFile
  } = useArticleStore(useShallow((state) => ({
    saveCurrentArticle: state.saveCurrentArticle,
    isPulling: state.isPulling,
    setCurrentArticle: state.setCurrentArticle,
    activeFilePath: state.activeFilePath,
    currentArticle: state.currentArticle,
    justPulledFile: state.justPulledFile,
  })))
  const {
    enableOutline,
    outlinePosition,
    setEnableOutline,
  } = useSettingStore(useShallow((state) => ({
    enableOutline: state.enableOutline,
    outlinePosition: state.outlinePosition,
    setEnableOutline: state.setEnableOutline,
  })))

  const t = useTranslations('article.file.sync')
  const tEditor = useTranslations('editor')
  const [initialContent, setInitialContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const isCreatingFileRef = useRef(false)
  // Track loaded state per file path - Bug fix: make this cleanup possible
  const loadedPathsRef = useRef<Set<string>>(new Set())
  // Bug fix: Track which file's content is currently in currentArticle
  const currentArticlePathRef = useRef<string | null>(null)
  // Bug fix: Track if editor content has been initialized to prevent saving empty content
  const contentInitializedRef = useRef(false)
  // Bug fix: Use ref to track loading state since state might be stale in callbacks
  const isLoadingRef = useRef(true)
  // Bug fix: Track expected content to detect if editor is behind
  const expectedContentRef = useRef<string | null>(null)
  // Outline panel state
  const [outlineWidth, setOutlineWidth] = useState(DEFAULT_OUTLINE_WIDTH)
  // State for editor instance (to trigger re-render when ready)
  const [editorInstance, setEditorInstance] = useState<any>(null)
  // Track if editor has called onEditorReady (meaning it's fully initialized)
  const [editorReady, setEditorReady] = useState(false)
  // AI streaming state
  const [aiStreaming, setAiStreaming] = useState(false)
  const terminateRef = useRef<(() => void) | undefined>(undefined)
  const learningReportReadOnly = isLearningReportMarkdown(initialContent || '', filePath)
  const learningReportDate = getDailyReportDateFromPath(filePath)

  const handleArchiveLearningReport = useCallback(async () => {
    if (!learningReportDate || !window.confirm(`确定归档 ${learningReportDate} 的日报吗？系统会先生成或更新所属规划周报，再隐藏该日报。`)) return
    try {
      const weeklyReport = await useLearningStore.getState().archiveReport(learningReportDate)
      await removeLearningReportMarkdown(filePath)
      const articleStore = useArticleStore.getState()
      await articleStore.cleanTabsByDeletedFile(filePath)
      articleStore.removeLocalEntry(filePath)
      await articleStore.loadFileTree({ skipRemoteSync: true })
      toast.success('日报已归档并汇总进规划周报', { description: weeklyReport.title })
    } catch (error) {
      toast.error('归档日报失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }, [filePath, learningReportDate])

  // Bug fix: Listen for file close events to clean up loaded state
  useEffect(() => {
    const handleFileClose = (event: { path: string }) => {
      if (event.path === filePath) {
        loadedPathsRef.current.delete(filePath)
      }
    }
    emitter.on('editor-file-close', handleFileClose as any)
    return () => {
      emitter.off('editor-file-close', handleFileClose as any)
      // Also clean up on component unmount
      loadedPathsRef.current.delete(filePath)
    }
  }, [filePath])

  // Bug fix: Listen for article opened events to track which file currentArticle belongs to
  useEffect(() => {
    const handleArticleOpened = (event: { path: string; content: string }) => {
      if (event.path === filePath) {
        currentArticlePathRef.current = filePath
      } else {
        // Bug fix: If a different file was opened, clear the reference
        currentArticlePathRef.current = null
      }
    }
    emitter.on('article-opened', handleArticleOpened as any)
    return () => {
      emitter.off('article-opened', handleArticleOpened as any)
    }
  }, [filePath])

  // Listen for AI streaming state
  useEffect(() => {
    const handleAiStreaming = (event: { isStreaming: boolean; targetFilePath?: string; terminate?: () => void }) => {
      // Check if this event is for the current file
      if (event.targetFilePath && event.targetFilePath !== filePath) {
        // Event is for a different file, ignore
        return
      }
      setAiStreaming(event.isStreaming)
      if (event.terminate) {
        terminateRef.current = event.terminate
      }
    }
    emitter.on('editor-ai-streaming', handleAiStreaming as any)
    return () => {
      emitter.off('editor-ai-streaming', handleAiStreaming as any)
    }
  }, [filePath])

  // Check store for AI generating state on mount and when filePath changes
  useEffect(() => {
    // Check if this file is currently being generated by AI
    const { aiGeneratingFilePath, aiTerminateFn } = useArticleStore.getState()
    if (aiGeneratingFilePath === filePath) {
      setAiStreaming(true)
      if (aiTerminateFn) {
        terminateRef.current = aiTerminateFn
      }
    }
  }, [filePath])

  const loadOutlineWidth = useCallback(async () => {
    const store = await Store.load('store.json')
    setOutlineWidth(normalizeOutlineWidth(await store.get(OUTLINE_WIDTH_STORE_KEY)))
  }, [])

  useEffect(() => {
    loadOutlineWidth()
  }, [loadOutlineWidth])

  useEffect(() => {
    if (!isActive) return

    loadOutlineWidth()
  }, [isActive, loadOutlineWidth])

  const handleToggleOutline = useCallback(() => {
    void setEnableOutline(!enableOutline)
  }, [enableOutline, setEnableOutline])

  const handleOutlineWidthChange = useCallback((width: number) => {
    setOutlineWidth(normalizeOutlineWidth(width))
  }, [])

  const handleOutlineWidthCommit = useCallback(async (width: number) => {
    const normalizedWidth = normalizeOutlineWidth(width)
    setOutlineWidth(normalizedWidth)
    const store = await Store.load('store.json')
    await store.set(OUTLINE_WIDTH_STORE_KEY, normalizedWidth)
  }, [])

  // Load content from cache or disk - only on first mount per file
  useEffect(() => {
    if (!filePath || loadedPathsRef.current.has(filePath)) return

    // Bug fix: Check cache first
    if (tabContentsRef.current && tabContentsRef.current[filePath] !== undefined) {
      setInitialContent(tabContentsRef.current[filePath])
      loadedPathsRef.current.add(filePath)
      setIsLoading(false)
      isLoadingRef.current = false
      return
    }

    // Bug fix: Also check if currentArticle belongs to this file (for store initialization)
    // This handles the case where app restarts and currentArticle is already set
    if (currentArticle && currentArticle.length > 0) {
      // Check if the current active file path matches
      const { activeFilePath: storeActivePath } = useArticleStore.getState()
      if (storeActivePath === filePath) {
        setInitialContent(currentArticle)
        loadedPathsRef.current.add(filePath)
        setIsLoading(false)
        isLoadingRef.current = false
        return
      }
    }

    // Load from disk directly (avoid using global currentArticle)
    const loadContent = async () => {
      setIsLoading(true)
      try {
        const { readTextFile } = await import('@tauri-apps/plugin-fs')
        const { getFilePathOptions } = await import('@/lib/workspace')

        const pathOptions = await getFilePathOptions(filePath)

        let content = ''
        if (!pathOptions.baseDir) {
          content = await readTextFile(pathOptions.path)
        } else {
          content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        }

        // Bug fix: Only set isLoading(false) if we have actual content
        // This prevents flickering when isLoading=false with empty content
        setInitialContent(content)
        // Update cache
        if (tabContentsRef.current) {
          tabContentsRef.current[filePath] = content
        }
        if (content) {
          setIsLoading(false)
          isLoadingRef.current = false
          // Mark content as initialized since we have actual content from disk
          // This is safe because the content came from disk, not an empty initialization
          contentInitializedRef.current = true
        }
        // If empty, wait for subscription
      } catch {
        // File doesn't exist
        setInitialContent('')
        // Don't set isLoading(false) here - wait for subscription
        // This prevents showing empty content briefly before subscription updates
      }
    }

    loadContent()
    loadedPathsRef.current.add(filePath)
  }, [filePath, tabContentsRef, currentArticle])

  // Subscribe to currentArticle changes (for remote file pull results)
  // Bug fix: Only update if currentArticle belongs to this file
  useEffect(() => {
    // Bug fix: Only process if currentArticle belongs to this file
    // Also check against store's activeFilePath as fallback
    const { activeFilePath: storeActivePath } = useArticleStore.getState()
    const isThisFile = currentArticlePathRef.current === filePath || storeActivePath === filePath

    if (currentArticle && currentArticle.length > 0 && currentArticle !== initialContent && isThisFile) {
      // Bug fix: Set expected content BEFORE updating initialContent
      // This ensures handleContentChange knows what to expect
      expectedContentRef.current = currentArticle
      setInitialContent(currentArticle)
      // Update cache
      if (tabContentsRef.current) {
        tabContentsRef.current[filePath] = currentArticle
      }
      // Bug fix: Don't set isLoadingRef.current = false here!
      // The editor needs to initialize first, and handleContentChange will
      // only save if content matches expectedContentRef
      // We'll set isLoading(false) but isLoadingRef remains true until editor confirms
      setIsLoading(false)
      // Mark as initialized so that subsequent saves are allowed
      contentInitializedRef.current = true

      // Fix cursor jump: Only trigger remote content update if this is a remote pull
      // This prevents unnecessary setContent during local saves
      if (justPulledFile) {
        emitter.emit('editor-content-from-remote', { content: currentArticle })
      }
    } else if (currentArticle === '' && isThisFile && initialContent === '') {
      // Genuinely empty file - hide loading and mark as initialized
      // Bug fix: Set expected content for empty file
      expectedContentRef.current = ''
      setIsLoading(false)
      isLoadingRef.current = false
      // Mark as initialized for empty files so user can start typing
      contentInitializedRef.current = true
    }
  }, [currentArticle, filePath, tabContentsRef, initialContent, justPulledFile])

  // Handle content changes - only save if this is the active file
  const handleContentChange = useCallback((content: string) => {
    // Ignore only the initial empty update; clearing an initialized document must still save.
    if (content.length === 0 && !contentInitializedRef.current) {
      return
    }
    // Bug fix: If expected content is set and incoming content doesn't match, skip save
    // This prevents saving stale content during editor initialization race
    // But clear expectedContentRef so subsequent edits can be saved
    if (expectedContentRef.current !== null && content !== expectedContentRef.current) {
      expectedContentRef.current = null
    }
    // Bug fix: Skip if content matches what we just loaded (first onUpdate after init)
    // The editor's onUpdate fires after setContent, so we skip that initial call
    if (expectedContentRef.current !== null && content === expectedContentRef.current) {
      // Clear expectedContentRef after first matching update
      expectedContentRef.current = null
      return
    }
    // Mark as initialized when we receive valid content
    if (!contentInitializedRef.current) {
      contentInitializedRef.current = true
    }
    // Update cache
    if (filePath && tabContentsRef.current) {
      tabContentsRef.current[filePath] = content
    }

    // Save to disk - only if this is the active file
    if (filePath && filePath === activeFilePath) {
      saveCurrentArticle(content, filePath)
    } else if (!filePath && !isCreatingFileRef.current) {
      // Auto-create untitled file
      isCreatingFileRef.current = true
      createUntitledFile(content)
      isCreatingFileRef.current = false
    }
  }, [saveCurrentArticle, filePath, tabContentsRef, activeFilePath])

  // Handle editor ready - store editor instance
  const handleEditorReady = useCallback((editor: any) => {
    setEditorInstance(editor)
    setEditorReady(true)
  }, [])

  // Reset editor instance and ready state when file changes
  useEffect(() => {
    setEditorInstance(null)
    setEditorReady(false)
  }, [filePath])

  // Auto-create untitled.md file
  async function createUntitledFile(content: string) {
    try {
      const { exists, writeTextFile } = await import('@tauri-apps/plugin-fs')
      const workspace = await import('@/lib/workspace').then(m => m.getWorkspacePath())
      const { getFilePathOptions } = await import('@/lib/workspace')

      let fileName = 'untitled.md'
      let counter = 1
      let path = fileName

      while (true) {
        const pathOptions = await getFilePathOptions(fileName)
        let fileExists = false
        if (workspace.isCustom) {
          fileExists = await exists(pathOptions.path)
        } else {
          fileExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
        if (!fileExists) break
        fileName = `untitled-${counter}.md`
        path = fileName
        counter++
      }

      const pathOptions = await getFilePathOptions(path)
      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, content)
      } else {
        await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
      }

      setCurrentArticle(content)
      useArticleStore.getState().setActiveFilePath(path)
      useArticleStore.getState().loadFileTree()
    } catch {
    }
  }

  // Loading state - wait for content to be loaded
  // 如果正在从远程拉取，优先显示拉取遮罩
  if (isPulling) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="relative">
            <Loader2 className="size-8 animate-spin" />
            <Download className="size-4 absolute inset-0 m-auto" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">{t('syncingRemote')}</p>
            <p className="text-xs mt-1">{t('pullingRemote')}</p>
          </div>
        </div>
      </div>
    )
  }

  // 如果 currentArticle 已经有内容，直接显示（拉取完成）
  const showContent = (currentArticle && currentArticle.length > 0) || initialContent !== null
  if (isLoading && !showContent) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div id="onboarding-target-editor-content" className="flex-1 relative w-full h-full">
      {learningReportReadOnly ? (
        <div className="absolute right-4 top-3 z-30 flex items-center gap-2 rounded-lg border bg-background/95 p-1.5 shadow-sm backdrop-blur">
          <div className="flex items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground" title="该文档由规划表单生成，不能直接编辑">
            <LockKeyhole className="size-3.5" />
            规划报告 · 只读
          </div>
          {learningReportDate ? <Button size="sm" variant="ghost" onClick={() => void handleArchiveLearningReport()}><Archive />归档</Button> : null}
        </div>
      ) : null}
      {/* Pull loading overlay */}
      {isPulling && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="relative">
              <Loader2 className="size-8 animate-spin" />
              <Download className="size-4 absolute inset-0 m-auto" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">{t('syncingRemote')}</p>
              <p className="text-xs mt-1">{t('pullingRemote')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Editor - initialContent only set once on mount */}
      <TipTapEditor
        initialContent={initialContent || ''}
        onChange={handleContentChange}
        placeholder={tEditor('placeholder')}
        activeFilePath={filePath}
        onEditorReady={handleEditorReady}
        outlineOpen={enableOutline}
        outlinePosition={outlinePosition}
        outlineWidth={outlineWidth}
        onToggleOutline={handleToggleOutline}
        applyLayoutPreferences
        editable={!isPulling && !aiStreaming && !learningReportReadOnly}
        autoScroll={aiStreaming}
        showOverlay={aiStreaming}
        onTerminate={() => {
          if (terminateRef.current) {
            terminateRef.current()
          } else {
            // If terminateRef is not set, emit abort event
            emitter.emit('abort-ai-streaming', {
              requestId: getActiveAiSuggestionRequestId(),
            })
          }}
        }
      />

      {enableOutline && !isPulling && editorReady && editorInstance && (
        <Outline
          editor={editorInstance}
          isOpen={enableOutline}
          position={outlinePosition}
          documentKey={filePath}
          width={outlineWidth}
          onWidthChange={handleOutlineWidthChange}
          onWidthCommit={handleOutlineWidthCommit}
          floating
        />
      )}
    </div>
  )
}

export default MdEditor
