'use client'

import { useEffect, useState } from 'react'
import { CalendarRange, NotebookPen } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import useLearningWorkspaceStore from '@/stores/learning-workspace'
import { PeriodReportsView } from './period-reports-view'
import { ReportView } from './report-view'

export function LearningReviewHub({ onOpenNote }: { onOpenNote?: (path: string | null) => void }) {
  const periodReportRequest = useLearningWorkspaceStore(state => state.periodReportRequest)
  const [section, setSection] = useState<'daily' | 'period'>('daily')

  useEffect(() => {
    if (periodReportRequest) setSection('period')
  }, [periodReportRequest])

  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">规划回顾</h1>
        <p className="mt-1 text-sm text-muted-foreground">先用表单记录每天的执行情况，再整理成只读的规划报告。</p>
      </div>
      <Tabs value={section} onValueChange={value => setSection(value as 'daily' | 'period')} className="gap-4">
        <TabsList>
          <TabsTrigger value="daily"><NotebookPen />每日回顾</TabsTrigger>
          <TabsTrigger value="period"><CalendarRange />周月总结</TabsTrigger>
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
