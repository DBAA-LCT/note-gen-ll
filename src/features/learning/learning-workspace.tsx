'use client'

import { useEffect, useRef } from 'react'
import { LoaderCircle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { formatLocalDate } from '@/lib/learning/date'
import useArticleStore from '@/stores/article'
import useLearningStore from '@/stores/learning'
import useLearningWorkspaceStore, { type PendingLearningReportDraft } from '@/stores/learning-workspace'
import type { AiLearningTaskDraft } from '@/types/learning'
import { FocusView } from './focus-view'
import { GoalsView } from './goals-view'
import { TodayView } from './today-view'
import { KnowledgeReviewView } from './knowledge-review-view'
import { LearningReviewHub } from './learning-review-hub'
import { LEARNING_WORKSPACE_PATH, planningViewNames } from './open-learning-workspace'
import { openGlobalSchedule } from '@/features/schedule/open-global-schedule'
import emitter from '@/lib/emitter'
import { toast } from 'sonner'

export function LearningWorkspace() {
  const { initialized, error, date, initialize, settings } = useLearningStore()
  const { activeView, createGoalSignal, setActiveView, requestCreateGoal, clearCreateGoalRequest, setPendingReportDraft } = useLearningWorkspaceStore()
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void initialize(formatLocalDate(Date.now(), settings.timeZone)).catch(() => undefined)
  }, [initialize, settings.timeZone])

  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0 })
  }, [activeView])

  useEffect(() => {
    if (activeView !== 'calendar') return
    void openGlobalSchedule()
      .catch(scheduleError => {
        toast.error('打开日程失败', { description: scheduleError instanceof Error ? scheduleError.message : String(scheduleError) })
      })
      .finally(() => setActiveView('today'))
  }, [activeView, setActiveView])

  useEffect(() => {
    const articleStore = useArticleStore.getState()
    const workspaceTab = articleStore.openTabs.find((tab) => tab.path === LEARNING_WORKSPACE_PATH)
    const tabName = planningViewNames[activeView]
    if (workspaceTab && workspaceTab.name !== tabName) {
      void articleStore.setOpenTabs(articleStore.openTabs.map((tab) => tab.id === workspaceTab.id ? { ...tab, name: tabName } : tab))
    }
  }, [activeView])

  useEffect(() => {
    const adoptPlan = async ({ date: targetDate, basedOnDate, tasks }: { date: string; basedOnDate: string | null; tasks: AiLearningTaskDraft[] }) => {
      await useLearningStore.getState().adoptAiPlan(targetDate, tasks, basedOnDate)
      await useLearningStore.getState().loadDate(targetDate)
      setActiveView('today')
    }
    const adoptReport = async (draft: PendingLearningReportDraft) => {
      setPendingReportDraft(draft)
      await useLearningStore.getState().loadDate(draft.date)
      setActiveView('reports')
    }
    emitter.on('learning-daily-plan-adopted', adoptPlan)
    emitter.on('learning-daily-report-adopted', adoptReport)
    return () => {
      emitter.off('learning-daily-plan-adopted', adoptPlan)
      emitter.off('learning-daily-report-adopted', adoptReport)
    }
  }, [setActiveView, setPendingReportDraft])

  const openNote = async (path: string | null) => {
    if (!path) return
    const articleStore = useArticleStore.getState()
    articleStore.insertLocalEntry(path, false)
    await articleStore.setActiveFilePath(path)
  }

  const navigate = (view: Parameters<typeof setActiveView>[0]) => {
    if (view === 'calendar') {
      void openGlobalSchedule().catch(scheduleError => {
        toast.error('打开日程失败', { description: scheduleError instanceof Error ? scheduleError.message : String(scheduleError) })
      })
      return
    }
    setActiveView(view)
  }

  const content = (() => {
    switch (activeView) {
      case 'calendar':
        return <TodayView onNavigate={navigate} onCreateGoal={requestCreateGoal} onOpenNote={(path) => void openNote(path)} />
      case 'goals':
        return <GoalsView createSignal={createGoalSignal} onCreateRequestHandled={clearCreateGoalRequest} onNavigate={setActiveView} />
      case 'focus':
        return <FocusView />
      case 'review':
        return <KnowledgeReviewView />
      case 'reports':
      case 'periods':
        return <LearningReviewHub onOpenNote={(path) => void openNote(path)} />
      case 'today':
      default:
        return <TodayView onNavigate={navigate} onCreateGoal={requestCreateGoal} onOpenNote={(path) => void openNote(path)} />
    }
  })()

  if (error && (!initialized || !date)) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-lg">
          <AlertTitle>规划空间加载失败</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col items-start gap-3">
            <span>{error}</span>
            <Button
              variant="outline"
              onClick={() => void initialize(formatLocalDate(Date.now(), settings.timeZone)).catch(() => undefined)}
            >
              <RotateCcw />重试
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!initialized || !date) {
    return (
      <div className="flex h-full flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        正在准备规划空间…
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/15">
      {error ? (
        <Alert variant="destructive" className="mx-4 mt-4 shrink-0">
          <AlertTitle>规划空间加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto">
        {content}
      </div>
    </div>
  )
}
