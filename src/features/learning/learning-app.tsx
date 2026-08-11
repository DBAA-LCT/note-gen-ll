'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Brain, CalendarDays, ClipboardCheck, Flag, LoaderCircle, RotateCcw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatLocalDate } from '@/lib/learning/date'
import { isTauriRuntime } from '@/lib/check'
import useLearningStore from '@/stores/learning'
import { FocusView } from './focus-view'
import { LearningCalendarView } from './calendar-view'
import { LearningReviewHub } from './learning-review-hub'
import { GoalsView } from './goals-view'
import { TodayView } from './today-view'
import { KnowledgeReviewView } from './knowledge-review-view'

export type LearningTab = 'today' | 'goals' | 'calendar' | 'review' | 'reports' | 'focus'

const primaryTabs: Array<{ value: Exclude<LearningTab, 'focus'>; label: string; icon: typeof ClipboardCheck }> = [
  { value: 'today', label: '今日', icon: ClipboardCheck },
  { value: 'goals', label: '目标', icon: Flag },
  { value: 'calendar', label: '日程', icon: CalendarDays },
  { value: 'review', label: '复习', icon: Brain },
  { value: 'reports', label: '复盘', icon: RotateCcw },
]

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

  if (!initialized || !date || loading) {
    return <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在准备目标数据…</div>
  }

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto bg-muted/15">
      {error && <Alert variant="destructive" className="mx-auto mt-4 max-w-6xl"><AlertTitle>目标模块加载失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      <Tabs value={tab} onValueChange={value => setTab(value as LearningTab)} className="min-h-full gap-0">
        {tab !== 'focus' ? (
          <div className="sticky top-0 z-20 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/85">
            <TabsList variant="line" className="mx-auto flex h-12 w-full min-w-0 max-w-6xl justify-start overflow-x-auto rounded-none bg-transparent p-0">
              {primaryTabs.map(item => {
                const Icon = item.icon
                return <TabsTrigger key={item.value} value={item.value} className="h-12 min-w-[72px] rounded-none px-4 text-sm data-[state=active]:font-medium"><Icon className="size-4" />{item.label}</TabsTrigger>
              })}
            </TabsList>
          </div>
        ) : null}
        <TabsContent value="today"><TodayView onNavigate={setTab} onCreateGoal={createGoal} onOpenNote={openNote} /></TabsContent>
        <TabsContent value="goals"><GoalsView createSignal={createSignal} onNavigate={setTab} /></TabsContent>
        <TabsContent value="calendar"><LearningCalendarView onNavigate={setTab} /></TabsContent>
        <TabsContent value="review"><KnowledgeReviewView /></TabsContent>
        <TabsContent value="reports"><LearningReviewHub onOpenNote={path => void openNote(path)} /></TabsContent>
        <TabsContent value="focus"><FocusView onBack={() => setTab('today')} /></TabsContent>
      </Tabs>
    </div>
  )
}
