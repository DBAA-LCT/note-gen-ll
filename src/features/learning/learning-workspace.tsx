'use client'

import { useEffect, useRef } from 'react'
import { BookOpenCheck, Brain, CalendarDays, ChartNoAxesColumnIncreasing, Flag, LoaderCircle, NotebookPen, TimerReset } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatLocalDate } from '@/lib/learning/date'
import useArticleStore from '@/stores/article'
import useLearningStore from '@/stores/learning'
import useLearningWorkspaceStore, { type LearningWorkspaceView } from '@/stores/learning-workspace'
import { FocusView } from './focus-view'
import { GoalsView } from './goals-view'
import { LearningCalendarView } from './calendar-view'
import { PeriodReportsView } from './period-reports-view'
import { ReportView } from './report-view'
import { TodayView } from './today-view'
import { KnowledgeReviewView } from './knowledge-review-view'

export function LearningWorkspace() {
  const { initialized, loading, error, date, initialize, settings } = useLearningStore()
  const { activeView, createGoalSignal, setActiveView, requestCreateGoal } = useLearningWorkspaceStore()
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void initialize(formatLocalDate(Date.now(), settings.timeZone)).catch(() => undefined)
  }, [initialize, settings.timeZone])

  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0 })
  }, [activeView])

  const openNote = async (path: string | null) => {
    if (!path) return
    const articleStore = useArticleStore.getState()
    articleStore.insertLocalEntry(path, false)
    await articleStore.setActiveFilePath(path)
  }

  if (!initialized || !date || loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        正在初始化目标数据…
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/15">
      {error ? (
        <Alert variant="destructive" className="mx-4 mt-4 shrink-0">
          <AlertTitle>目标模块加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs
        value={activeView}
        onValueChange={(value) => setActiveView(value as LearningWorkspaceView)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="shrink-0 overflow-x-auto border-b bg-background px-5">
          <TabsList variant="line" className="h-11 w-max min-w-full justify-start gap-1 bg-transparent">
            <TabsTrigger value="today"><BookOpenCheck />今日</TabsTrigger>
            <TabsTrigger value="calendar"><CalendarDays />日程</TabsTrigger>
            <TabsTrigger value="goals"><Flag />目标</TabsTrigger>
            <TabsTrigger value="focus"><TimerReset />专注</TabsTrigger>
            <TabsTrigger value="review"><Brain />知识复习</TabsTrigger>
            <TabsTrigger value="reports"><NotebookPen />日报</TabsTrigger>
            <TabsTrigger value="periods"><ChartNoAxesColumnIncreasing />周期报告</TabsTrigger>
          </TabsList>
        </div>

        <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="today" className="mt-0">
            <TodayView onNavigate={setActiveView} onCreateGoal={requestCreateGoal} onOpenNote={(path) => void openNote(path)} />
          </TabsContent>
          <TabsContent value="calendar" className="mt-0">
            <LearningCalendarView onNavigate={setActiveView} />
          </TabsContent>
          <TabsContent value="goals" className="mt-0">
            <GoalsView createSignal={createGoalSignal} />
          </TabsContent>
          <TabsContent value="focus" className="mt-0"><FocusView /></TabsContent>
          <TabsContent value="review" className="mt-0"><KnowledgeReviewView /></TabsContent>
          <TabsContent value="reports" className="mt-0">
            <ReportView onSaved={(path) => void openNote(path)} />
          </TabsContent>
          <TabsContent value="periods" className="mt-0">
            <PeriodReportsView onOpenNote={(path) => void openNote(path)} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
