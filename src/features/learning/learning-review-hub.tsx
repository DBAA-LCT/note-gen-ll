'use client'

import { CalendarRange, NotebookPen } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PeriodReportsView } from './period-reports-view'
import { ReportView } from './report-view'

export function LearningReviewHub({ onOpenNote }: { onOpenNote?: (path: string | null) => void }) {
  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">学习复盘</h1>
        <p className="mt-1 text-sm text-muted-foreground">先记录当天，再从日记、专注和任务中整理周报或月报。</p>
      </div>
      <Tabs defaultValue="daily" className="gap-4">
        <TabsList>
          <TabsTrigger value="daily"><NotebookPen />每日复盘</TabsTrigger>
          <TabsTrigger value="period"><CalendarRange />周报与月报</TabsTrigger>
        </TabsList>
        <TabsContent value="daily" className="[&>div]:max-w-none [&>div]:p-0">
          <ReportView onSaved={onOpenNote} />
        </TabsContent>
        <TabsContent value="period" className="[&>div]:max-w-none [&>div]:p-0">
          <PeriodReportsView onOpenNote={path => onOpenNote?.(path)} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
