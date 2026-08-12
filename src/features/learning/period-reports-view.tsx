'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FilePenLine, RefreshCw, Save, SquareArrowOutUpRight } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { getPeriodicLearningReport, savePeriodicLearningReport } from '@/lib/learning/repository'
import { formatLocalDate } from '@/lib/learning/date'
import { generateLocalPeriodicReport, getLearningPeriodBounds, shiftLearningPeriod } from '@/lib/learning/period-report'
import { writePeriodicReportMarkdown } from '@/lib/learning/report'
import { isTauriRuntime } from '@/lib/check'
import useLearningStore from '@/stores/learning'
import type { PeriodicLearningReport, PeriodicLearningReportType } from '@/types/learning'
import useLearningWorkspaceStore from '@/stores/learning-workspace'

export function PeriodReportsView({ onOpenNote }: { onOpenNote?: (path: string) => void } = {}) {
  const settings = useLearningStore(state => state.settings)
  const { periodReportRequest, clearPeriodReportRequest } = useLearningWorkspaceStore()
  const [type, setType] = useState<PeriodicLearningReportType>('week')
  const [anchor, setAnchor] = useState(() => formatLocalDate(Date.now(), settings.timeZone))
  const [report, setReport] = useState<PeriodicLearningReport | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const nativeRuntime = isTauriRuntime()
  const bounds = useMemo(() => getLearningPeriodBounds(type, anchor), [anchor, type])

  useEffect(() => {
    if (!periodReportRequest) return
    setType(periodReportRequest.type)
    setAnchor(periodReportRequest.anchor)
    clearPeriodReportRequest()
  }, [clearPeriodReportRequest, periodReportRequest])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void getPeriodicLearningReport(type, bounds.start, bounds.end).then(value => {
      if (cancelled) return
      setReport(value)
      setTitle(value?.title || '')
      setContent(value?.content || '')
      setEditing(false)
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bounds.end, bounds.start, type])

  const generate = async () => {
    setLoading(true)
    try {
      const draft = await generateLocalPeriodicReport(type, bounds.start, bounds.end)
      const saved = await savePeriodicLearningReport(draft)
      setReport(saved)
      setTitle(saved.title)
      setContent(saved.content)
      setEditing(false)
      toast.success(type === 'week' ? '周报已生成' : '月报已生成')
    } catch (error) {
      toast.error('生成报告失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    if (!report) return
    try {
      const saved = await savePeriodicLearningReport({
        type,
        periodStart: bounds.start,
        periodEnd: bounds.end,
        title: title.trim() || report.title,
        content,
        metrics: report.metrics,
        sourceDates: report.sourceDates,
      })
      setReport(saved)
      setEditing(false)
      toast.success('报告修改已保存')
    } catch (error) {
      toast.error('保存失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const openAsNote = async () => {
    if (!report || !nativeRuntime) return
    setExporting(true)
    try {
      const path = await writePeriodicReportMarkdown({ ...report, content }, settings.reportDirectory)
      toast.success('规划报告已写入 NoteGen')
      onOpenNote?.(path)
    } catch (error) {
      toast.error('写入规划报告失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">周月总结</h1><p className="text-sm text-muted-foreground">周报只汇总日报，月报只汇总已生成的周报。</p></div>
        <Tabs value={type} onValueChange={value => setType(value as PeriodicLearningReportType)}>
          <TabsList><TabsTrigger value="week">周报</TabsTrigger><TabsTrigger value="month">月报</TabsTrigger></TabsList>
        </Tabs>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="outline" onClick={() => setAnchor(value => shiftLearningPeriod(type, value, -1))}><ChevronLeft /></Button>
          <Button variant="outline" onClick={() => setAnchor(formatLocalDate(Date.now(), settings.timeZone))}>本周期</Button>
          <Button size="icon-sm" variant="outline" onClick={() => setAnchor(value => shiftLearningPeriod(type, value, 1))}><ChevronRight /></Button>
        </div>
        <p className="text-sm font-medium">{bounds.start} 至 {bounds.end}</p>
        <Button onClick={() => void generate()} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />{report ? '重新生成' : '生成报告'}</Button>
      </div>

      {report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card><CardHeader className="pb-2"><CardDescription>执行天数</CardDescription><CardTitle>{report.metrics.studyDays} 天</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>专注时长</CardDescription><CardTitle>{Math.floor(report.metrics.focusedMinutes / 60)}h {report.metrics.focusedMinutes % 60}m</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>完成任务</CardDescription><CardTitle>{report.metrics.taskDone}/{report.metrics.taskTotal}</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>{type === 'week' ? '日报来源' : '周报来源'}</CardDescription><CardTitle>{type === 'week' ? `${report.metrics.reportDays} 天` : `${report.sourceDates.length} 篇`}</CardTitle></CardHeader></Card>
          </div>
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div><CardTitle>{report.title}</CardTitle><CardDescription>生成于 {new Date(report.updatedAt).toLocaleString()}</CardDescription></div>
              <div className="flex flex-wrap justify-end gap-2">
                {nativeRuntime ? <Button variant="outline" onClick={() => void openAsNote()} disabled={exporting}><SquareArrowOutUpRight />{exporting ? '写入中…' : '打开只读报告'}</Button> : null}
                <Button variant="outline" onClick={() => setEditing(value => !value)}><FilePenLine />{editing ? '预览' : '编辑'}</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {editing ? (
                <><Input value={title} onChange={event => setTitle(event.target.value)} /><Textarea value={content} onChange={event => setContent(event.target.value)} className="min-h-[420px] font-mono text-sm" /><Button onClick={() => void save()}><Save />保存修改</Button></>
              ) : <div className="whitespace-pre-wrap rounded-lg border bg-muted/20 p-4 text-sm leading-7">{content}</div>}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card><CardContent className="flex flex-col items-center gap-3 py-14 text-center"><FilePenLine className="size-10 text-muted-foreground" /><div><p className="font-medium">这个周期还没有报告</p><p className="text-sm text-muted-foreground">{type === 'week' ? '周报会汇总该周的日报、任务和专注记录。' : '月报只会汇总该月已完成的规划周报。'}</p></div><Button onClick={() => void generate()} disabled={loading}>生成{type === 'week' ? '周报' : '月报'}</Button></CardContent></Card>
      )}
    </div>
  )
}
