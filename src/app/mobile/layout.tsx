'use client'

import { ThemeProvider } from "@/components/theme-provider"
import useSettingStore from "@/stores/setting"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import dynamic from "next/dynamic"
import { applyThemeColors } from "@/lib/theme-utils"
import { applyAppFontFamily } from "@/lib/font-settings"
import dayjs from "dayjs"
import zh from "dayjs/locale/zh-cn";
import en from "dayjs/locale/en";
import { useI18n } from "@/hooks/useI18n"
import { TooltipProvider } from "@/components/ui/tooltip";
import './mobile-styles.css'
import { AppFootbar } from "@/components/app-footbar"
import { MobileStatusBar } from "@/components/mobile-statusbar"
import { TextSizeProvider } from "@/contexts/text-size-context"
import { MobileViewport } from "@/components/mobile-viewport"
import { MobileModeProvider } from "@/hooks/use-mobile"
import { Skeleton } from "@/components/ui/skeleton"
import AppStatus from "@/components/app-status"
import { isTauriRuntime } from '@/lib/check'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { RotateCcw, TriangleAlert } from 'lucide-react'

const WritingScreen = dynamic(
  () => import('./writing/writing-screen').then(module => module.WritingScreen),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full flex-col gap-3 p-3" aria-busy="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="min-h-0 flex-1 w-full" />
      </div>
    ),
  },
)
const MemoryAutoNotifications = dynamic(
  () => import('@/components/memories/memory-auto-notifications').then(module => module.MemoryAutoNotifications),
  { ssr: false },
)
const SyncConfirmDialog = dynamic(
  () => import('@/components/sync-confirm-dialog').then(module => module.SyncConfirmDialog),
  { ssr: false },
)
const ControlText = dynamic(
  () => import('@/app/core/main/mark/control-text').then(module => module.ControlText),
  { ssr: false },
)
const ControlRecording = dynamic(
  () => import('@/app/core/main/mark/control-recording').then(module => module.ControlRecording),
  { ssr: false },
)
const ControlImage = dynamic(
  () => import('@/app/core/main/mark/control-image').then(module => module.ControlImage),
  { ssr: false },
)
const ControlLink = dynamic(
  () => import('@/app/core/main/mark/control-link').then(module => module.ControlLink),
  { ssr: false },
)
const ControlTodo = dynamic(
  () => import('@/app/core/main/mark/control-todo').then(module => module.ControlTodo),
  { ssr: false },
)

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname()
  const nativeRuntime = isTauriRuntime()
  const isWritingRoute = nativeRuntime && pathname === '/mobile/writing'
  const [hasWritingCache, setHasWritingCache] = useState(isWritingRoute)
  const [initializationError, setInitializationError] = useState<string | null>(null)
  const [initializationAttempt, setInitializationAttempt] = useState(0)
  const { initSettingData, customThemeColors, appFontFamily } = useSettingStore()
  const { currentLocale } = useI18n()
  useEffect(() => {
    if (isWritingRoute) {
      setHasWritingCache(true)
    }
  }, [isWritingRoute])

  useEffect(() => {
    if (isWritingRoute) {
      return
    }

    const writingRoot = document.getElementById('mobile-writing')
    const activeElement = document.activeElement
    if (writingRoot && activeElement instanceof HTMLElement && writingRoot.contains(activeElement)) {
      activeElement.blur()
    }
  }, [isWritingRoute])

  useEffect(() => {
    let cancelled = false

    if (isTauriRuntime()) {
      void import('@/lib/event-report').then(({ reportAppStart }) => reportAppStart())
    }

    const initializeApp = async () => {
      setInitializationError(null)
      try {
        if (!isTauriRuntime()) return
        const [
          { initAllDatabases },
          { initAutoDataSyncRuntime },
          { initMcp },
          { getSyncPushQueue },
        ] = await Promise.all([
          import('@/db'),
          import('@/lib/sync/auto-data-sync-queue'),
          import('@/lib/mcp/init'),
          import('@/lib/sync/sync-push-queue'),
        ])
        await initSettingData()
        getSyncPushQueue()
        const useImageStore = (await import('@/stores/imageHosting')).default
        useImageStore.getState().initMainHosting()
        await initAllDatabases()
        if (cancelled) return
        const { runMemoryMaintenance } = await import('@/lib/memory/auto-memory')
        void runMemoryMaintenance()
        const {
          reconcileMemoryEmbeddingModel,
          reindexPendingMemories,
        } = await import('@/db/memories')
        await reconcileMemoryEmbeddingModel()
        void reindexPendingMemories()
        const useArticleStore = (await import('@/stores/article')).default
        await useArticleStore.getState().initCollapsibleList()
        if (cancelled) return
        await initAutoDataSyncRuntime()
        if (cancelled) return
        const useVectorStore = (await import('@/stores/vector')).default
        await useVectorStore.getState().initVectorDb()
        if (cancelled) return
        await useArticleStore.getState().initVectorIndexedFiles()
        if (cancelled) return
        initMcp()
      } catch (error) {
        console.error('Failed to initialize mobile app:', error)
        if (!cancelled) {
          setInitializationError(error instanceof Error ? error.message : String(error))
        }
      }
    }

    void initializeApp()

    return () => {
      cancelled = true
    }
  }, [initializationAttempt, initSettingData])

  useEffect(() => {
    switch (currentLocale) {
      case 'zh':
        dayjs.locale(zh);
        break;
      case 'en':
        dayjs.locale(en);
        break;
      default:
        break;
    }
  }, [currentLocale])

  // 应用自定义主题颜色
  useEffect(() => {
    applyThemeColors(customThemeColors)
  }, [customThemeColors])

  // 应用字体
  useEffect(() => {
    applyAppFontFamily(appFontFamily)
  }, [appFontFamily])

  const hideFootbar =
    pathname.startsWith('/mobile/setting/pages')
    || pathname === '/mobile/record/detail'

  return (
    <MobileModeProvider mobile>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <TextSizeProvider>
          <MobileViewport />
          <MobileStatusBar />
          {nativeRuntime ? <AppStatus /> : null}
          <TooltipProvider>
            <div className="mobile-app-shell flex flex-col">
              {initializationError ? (
                <div className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[60] mx-auto max-w-lg">
                  <Alert variant="destructive" className="shadow-lg">
                    <TriangleAlert />
                    <AlertTitle>应用初始化失败</AlertTitle>
                    <AlertDescription className="mt-2 flex flex-col items-start gap-3">
                      <span className="line-clamp-3">{initializationError}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setInitializationAttempt(value => value + 1)}
                      >
                        <RotateCcw />重试
                      </Button>
                    </AlertDescription>
                  </Alert>
                </div>
              ) : null}
              <main className="mobile-app-main flex flex-1 w-full overflow-hidden">
                {hasWritingCache ? (
                  <div
                    className={isWritingRoute ? "h-full w-full min-w-0" : "hidden"}
                    aria-hidden={!isWritingRoute}
                  >
                    <WritingScreen />
                  </div>
                ) : null}
                {!isWritingRoute ? children : null}
              </main>
              {!hideFootbar ? (
                <div className="mobile-footbar">
                  <AppFootbar />
                </div>
              ) : null}
            </div>
            {/* 隐藏的记录工具组件，用于监听事件 */}
            {nativeRuntime ? (
              <div className="absolute opacity-0 pointer-events-none -z-50">
                <ControlText />
                <ControlRecording />
                <ControlImage />
                <ControlLink />
                <ControlTodo />
              </div>
            ) : null}
          </TooltipProvider>
          {nativeRuntime ? <SyncConfirmDialog /> : null}
          {nativeRuntime ? <MemoryAutoNotifications /> : null}
        </TextSizeProvider>
      </ThemeProvider>
    </MobileModeProvider>
  );
}
