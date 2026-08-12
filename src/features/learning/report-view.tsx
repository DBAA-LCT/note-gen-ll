'use client'

import { useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, FileText, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { removeLearningReportMarkdown, writeDailyReportMarkdown } from '@/lib/learning/report'
import { isTauriRuntime } from '@/lib/check'
import useLearningStore from '@/stores/learning'
import useLearningWorkspaceStore from '@/stores/learning-workspace'
import { useSidebarStore } from '@/stores/sidebar'
import emitter from '@/lib/emitter'
import type { DailyReflection, DailyReportGoalEntry, LearningExecutionStatus, SaveDailyReportInput } from '@/types/learning'

const EMPTY_REFLECTION: DailyReflection = {
  energyLevel: null,
  focusLevel: null,
  biggestWin: '',
  biggestBlocker: '',
  nextIntention: '',
}

export function ReportView({ onSaved }: { onSaved?: (markdownPath: string | null) => void } = {}) {
  const { date, goals, sessions, report, archivedReports, settings, loading, loadDate, saveReport, archiveReport, restoreReport, deleteArchivedReport } = useLearningStore()
  const { pendingReportDraft, setPendingReportDraft } = useLearningWorkspaceStore()
  const { rightSidebarVisible, toggleRightSidebar } = useSidebarStore()
  const [overall, setOverall] = useState('')
  const [reflection, setReflection] = useState<DailyReflection>(EMPTY_REFLECTION)
  const [entries, setEntries] = useState<DailyReportGoalEntry[]>([])
  const nativeRuntime = isTauriRuntime()
  const [writeMarkdown, setWriteMarkdown] = useState(nativeRuntime)
  const [saving, setSaving] = useState(false)

  const studyMinutesByGoal = useMemo(() => {
    const result = new Map<string, number>()
    for (const session of sessions) {
      if (!session.goalId || session.status !== 'completed') continue
      result.set(session.goalId, (result.get(session.goalId) || 0) + Math.round(session.effectiveSeconds / 60))
    }
    return result
  }, [sessions])

  useEffect(() => {
    setOverall(report?.overall || '')
    setReflection(report?.reflection || EMPTY_REFLECTION)
    setEntries(goals.map(goal => {
      const saved = report?.entries.find(entry => entry.goalId === goal.id)
      return saved || {
        goalId: goal.id,
        goalTitle: goal.title,
        status: 'not-done' as const,
        progressPercent: goal.progressPercent,
        studyMinutes: studyMinutesByGoal.get(goal.id) || 0,
        content: '',
      }
    }))
  }, [goals, report, studyMinutesByGoal])

  useEffect(() => {
    if (!pendingReportDraft || pendingReportDraft.date !== date) return
    setOverall(current => pendingReportDraft.overall || current)
    setReflection(current => ({
      energyLevel: pendingReportDraft.reflection.energyLevel ?? current.energyLevel,
      focusLevel: pendingReportDraft.reflection.focusLevel ?? current.focusLevel,
      biggestWin: pendingReportDraft.reflection.biggestWin || current.biggestWin,
      biggestBlocker: pendingReportDraft.reflection.biggestBlocker || current.biggestBlocker,
      nextIntention: pendingReportDraft.reflection.nextIntention || current.nextIntention,
    }))
    setEntries(current => {
      const incoming = new Map(pendingReportDraft.entries.map(entry => [entry.goalId, entry]))
      const merged = current.map(entry => incoming.get(entry.goalId) || entry)
      const known = new Set(merged.map(entry => entry.goalId))
      return [...merged, ...pendingReportDraft.entries.filter(entry => !known.has(entry.goalId))]
    })
    setPendingReportDraft(null)
    toast.success('AI 日报草案已合并，请确认后保存')
  }, [date, pendingReportDraft, setPendingReportDraft])

  const updateEntry = (goalId: string, patch: Partial<DailyReportGoalEntry>) => {
    setEntries(current => current.map(entry => entry.goalId === goalId ? { ...entry, ...patch } : entry))
  }

  const startAiInterview = async () => {
    if (!rightSidebarVisible) await toggleRightSidebar()
    const prompt = `请采访我并生成 ${date} 的整日回顾。先调用 learning_get_context 读取今天的任务、专注记录、已有单项目标日报以及近期汇总。采访的每一轮必须调用 learning_ask_interview_question 生成问题卡，一次只问一个问题并等待回答，不要用普通正文代替问题卡。封闭问题使用 direct，开放问题使用 draft。再逐项询问实际完成内容、状态、困难、收获和下一步调整。信息充分后调用 learning_propose_daily_report 生成 whole-day 草案卡片，不要直接保存或完成打卡。`
    window.setTimeout(() => emitter.emit('quick-prompt-insert', prompt), 120)
  }

  const handleSave = async (completeDay: boolean) => {
    setSaving(true)
    try {
      let input: SaveDailyReportInput = { localDate: date, overall, reflection, entries, completedAt: completeDay ? Date.now() : report?.completedAt || null }
      if (nativeRuntime && writeMarkdown) {
        try {
          input = { ...input, markdownPath: await writeDailyReportMarkdown(input, settings.reportDirectory) }
        } catch (error) {
          toast.warning('Markdown 写入失败，结构化日报仍会保存', { description: error instanceof Error ? error.message : String(error) })
        }
      }
      const savedReport = await saveReport(input)
      onSaved?.(savedReport.markdownPath)
      toast.success(completeDay ? '今日打卡已完成' : '日报进度已保存')
    } catch (error) {
      toast.error('保存日报失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async () => {
    if (!report || !window.confirm(`确定归档 ${date} 的日报吗？系统会先生成或更新所属规划周报，再隐藏该日报。`)) return
    setSaving(true)
    try {
      const weeklyReport = await archiveReport(date)
      await removeLearningReportMarkdown(report.markdownPath)
      if (report.markdownPath) {
        const articleStore = (await import('@/stores/article')).default.getState()
        await articleStore.cleanTabsByDeletedFile(report.markdownPath)
        articleStore.removeLocalEntry(report.markdownPath)
        await articleStore.loadFileTree({ skipRemoteSync: true })
      }
      toast.success('日报已归档并汇总进规划周报', { description: weeklyReport.title })
    } catch (error) {
      toast.error('归档日报失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  const handleRestore = async (targetDate: string) => {
    try {
      await restoreReport(targetDate)
      await loadDate(targetDate)
      toast.success('日报已恢复', { description: '请在表单中检查后保存，以重新生成只读 Markdown。' })
    } catch (error) {
      toast.error('恢复日报失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const handlePermanentDelete = async (targetDate: string) => {
    if (!window.confirm(`确定永久删除 ${targetDate} 的日报吗？该日报已汇总进规划周报，删除后无法恢复，但周报和后续月报不受影响。`)) return
    try {
      await deleteArchivedReport(targetDate)
      toast.success('日报已永久删除')
    } catch (error) {
      toast.error('永久删除日报失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">每日回顾</h1><p className="text-sm text-muted-foreground">{nativeRuntime ? '回顾会保存为只读的 Markdown 规划报告，需要修改时请使用此表单。' : 'Web 测试版会把回顾保存在当前浏览器。'}</p></div>
        <div className="space-y-1"><Label htmlFor="report-date">日期</Label><Input id="report-date" type="date" value={date} onChange={event => void loadDate(event.target.value)} /></div>
      </div>

      <Card>
        <CardHeader className="flex-col items-start justify-between gap-3 sm:flex-row"><div><CardTitle>今天怎么样</CardTitle><CardDescription>{nativeRuntime ? '可以自己写，也可以让 AI 用几个问题帮你整理。' : '记录今天完成的内容和实际效果。'}</CardDescription></div>{nativeRuntime ? <Button variant="outline" onClick={() => void startAiInterview()}><Sparkles data-icon="inline-start" />AI 帮我整理</Button> : null}</CardHeader>
        <CardContent><Textarea value={overall} onChange={event => setOverall(event.target.value)} placeholder="今天完成了什么、效果如何？" maxRows={8} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>执行内容</CardTitle><CardDescription>按目标整理今天做过的事情，相关时长会自动汇总。</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {entries.length ? entries.map(entry => (
            <div key={entry.goalId} className="space-y-3 rounded-lg border p-4">
              <p className="font-medium">{entry.goalTitle}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1"><Label>执行状态</Label><Select value={entry.status} onValueChange={value => updateEntry(entry.goalId, { status: value as LearningExecutionStatus })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="done">完成</SelectItem><SelectItem value="partial">部分完成</SelectItem><SelectItem value="not-done">未完成</SelectItem></SelectContent></Select></div>
                <div className="space-y-1"><Label>累计进度（%）</Label><Input type="number" min={0} max={100} value={entry.progressPercent} onChange={event => updateEntry(entry.goalId, { progressPercent: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /></div>
                <div className="space-y-1"><Label>投入分钟数</Label><Input type="number" min={0} value={entry.studyMinutes} onChange={event => updateEntry(entry.goalId, { studyMinutes: Math.max(0, Number(event.target.value) || 0) })} /></div>
              </div>
              <Textarea value={entry.content} onChange={event => updateEntry(entry.goalId, { content: event.target.value })} placeholder="完成内容、成果或未完成原因" maxRows={6} />
            </div>
          )) : <p className="py-6 text-center text-sm text-muted-foreground">当前没有可记录的目标。</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>留给下一次</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1"><Label>精力状态（1–5）</Label><Input type="number" min={1} max={5} value={reflection.energyLevel ?? ''} onChange={event => setReflection({ ...reflection, energyLevel: event.target.value ? Number(event.target.value) : null })} /></div>
          <div className="space-y-1"><Label>专注程度（1–5）</Label><Input type="number" min={1} max={5} value={reflection.focusLevel ?? ''} onChange={event => setReflection({ ...reflection, focusLevel: event.target.value ? Number(event.target.value) : null })} /></div>
          <div className="space-y-1"><Label>最大收获</Label><Textarea value={reflection.biggestWin} onChange={event => setReflection({ ...reflection, biggestWin: event.target.value })} /></div>
          <div className="space-y-1"><Label>主要困难</Label><Textarea value={reflection.biggestBlocker} onChange={event => setReflection({ ...reflection, biggestBlocker: event.target.value })} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>下次调整</Label><Textarea value={reflection.nextIntention} onChange={event => setReflection({ ...reflection, nextIntention: event.target.value })} /></div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        {nativeRuntime ? <label className="flex items-center gap-2 text-sm"><Checkbox checked={writeMarkdown} onCheckedChange={checked => setWriteMarkdown(checked === true)} /><FileText className="size-4" />生成只读规划报告</label> : <p className="text-sm text-muted-foreground">仅保存在此浏览器。</p>}
        <div className="flex gap-2">{report ? <Button variant="ghost" onClick={() => void handleArchive()} disabled={saving || loading}><Archive />归档日报</Button> : null}<Button variant="outline" onClick={() => void handleSave(false)} disabled={saving || loading}>{saving ? '保存中…' : '暂存'}</Button><Button onClick={() => void handleSave(true)} disabled={saving || loading}>{report?.completedAt ? '更新回顾' : '完成今天'}</Button></div>
      </div>

      {archivedReports.length ? (
        <Card>
          <CardHeader><CardTitle className="text-base">已归档日报</CardTitle><CardDescription>这些日报已纳入规划周报，不再出现在日历和普通报告中。</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {archivedReports.map(item => <div key={item.localDate} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"><div className="min-w-0"><p className="font-medium">{item.localDate}</p><p className="truncate text-xs text-muted-foreground">{item.overall || '无总体回顾'}</p></div><div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" onClick={() => void handleRestore(item.localDate)}><ArchiveRestore />恢复</Button><Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void handlePermanentDelete(item.localDate)}><Trash2 />永久删除</Button></div></div>)}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
