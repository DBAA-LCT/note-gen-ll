'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpenCheck, Brain, CalendarDays, ChartNoAxesColumnIncreasing, Flag, LoaderCircle, NotebookPen, TimerReset } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatLocalDate } from '@/lib/learning/date'
import { isTauriRuntime } from '@/lib/check'
import useLearningStore from '@/stores/learning'
import { FocusView } from './focus-view'
import { LearningCalendarView } from './calendar-view'
import { PeriodReportsView } from './period-reports-view'
import { GoalsView } from './goals-view'
import { ReportView } from './report-view'
import { TodayView } from './today-view'
import { KnowledgeReviewView } from './knowledge-review-view'

type LearningTab = 'today' | 'calendar' | 'goals' | 'focus' | 'review' | 'reports' | 'periods'

export function LearningApp() {
  const router = useRouter()
  const { initialized, loading, error, date, initialize, settings } = useLearningStore()
  const [tab, setTab] = useState<LearningTab>('today')
  const [createSignal, setCreateSignal] = useState(0)

  useEffect(() => {
    void initialize(formatLocalDate(Date.now(), settings.timeZone)).catch(() => undefined)
  }, [initialize, settings.timeZone])

  const createGoal = () => {
    setTab('goals')
    setCreateSignal(value => value + 1)
  }

  const openNote = async (path: string | null) => {
    if (!path || !isTauriRuntime()) return
    const useArticleStore = (await import('@/stores/article')).default
    useArticleStore.getState().insertLocalEntry(path, false)
    await useArticleStore.getState().setActiveFilePath(path)
    router.push('/mobile/writing')
  }

  if (!initialized || !date || loading) return <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在初始化学习模块…</div>

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto bg-muted/20">
      {error && <Alert variant="destructive" className="mx-auto mt-4 max-w-5xl"><AlertTitle>学习模块加载失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      <Tabs value={tab} onValueChange={value => setTab(value as LearningTab)} className="min-h-full gap-0">
        <div className="sticky top-0 z-20 border-b bg-background/95 px-4 py-2 backdrop-blur">
          <TabsList variant="line" className="mx-auto flex h-9 w-full min-w-0 max-w-5xl justify-start overflow-x-auto">
            <TabsTrigger value="today"><BookOpenCheck className="hidden sm:block" />今天</TabsTrigger>
            <TabsTrigger value="calendar"><CalendarDays className="hidden sm:block" />日历</TabsTrigger>
            <TabsTrigger value="goals"><Flag className="hidden sm:block" />目标</TabsTrigger>
            <TabsTrigger value="focus"><TimerReset className="hidden sm:block" />专注</TabsTrigger>
            <TabsTrigger value="review"><Brain className="hidden sm:block" />复习</TabsTrigger>
            <TabsTrigger value="reports"><NotebookPen className="hidden sm:block" />日报</TabsTrigger>
            <TabsTrigger value="periods"><ChartNoAxesColumnIncreasing className="hidden sm:block" />汇总</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="today"><TodayView onNavigate={setTab} onCreateGoal={createGoal} onOpenNote={openNote} /></TabsContent>
        <TabsContent value="calendar"><LearningCalendarView onNavigate={setTab} /></TabsContent>
        <TabsContent value="goals"><GoalsView createSignal={createSignal} /></TabsContent>
        <TabsContent value="focus"><FocusView /></TabsContent>
        <TabsContent value="review"><KnowledgeReviewView /></TabsContent>
        <TabsContent value="reports"><ReportView onSaved={path => void openNote(path)} /></TabsContent>
        <TabsContent value="periods"><PeriodReportsView onOpenNote={path => void openNote(path)} /></TabsContent>
      </Tabs>
    </div>
  )
}
