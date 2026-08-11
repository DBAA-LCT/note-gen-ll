'use client'

import { useEffect, useMemo, useState } from 'react'
import { FileText, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { createDailyReviewDraftWithAi } from '@/lib/learning/ai'
import { nextStudyDate } from '@/lib/learning/date'
import { writeDailyReportMarkdown } from '@/lib/learning/report'
import { isTauriRuntime } from '@/lib/check'
import useLearningStore from '@/stores/learning'
import type { DailyReflection, DailyReportGoalEntry, LearningExecutionStatus, SaveDailyReportInput } from '@/types/learning'

const EMPTY_REFLECTION: DailyReflection = {
  energyLevel: null,
  focusLevel: null,
  biggestWin: '',
  biggestBlocker: '',
  nextIntention: '',
}

export function ReportView({ onSaved }: { onSaved?: (markdownPath: string | null) => void } = {}) {
  const { date, goals, tasks, sessions, report, settings, loading, loadDate, saveReport, ensureTasks } = useLearningStore()
  const [overall, setOverall] = useState('')
  const [reflection, setReflection] = useState<DailyReflection>(EMPTY_REFLECTION)
  const [entries, setEntries] = useState<DailyReportGoalEntry[]>([])
  const nativeRuntime = isTauriRuntime()
  const [writeMarkdown, setWriteMarkdown] = useState(nativeRuntime)
  const [saving, setSaving] = useState(false)
  const [drafting, setDrafting] = useState(false)

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

  const updateEntry = (goalId: string, patch: Partial<DailyReportGoalEntry>) => {
    setEntries(current => current.map(entry => entry.goalId === goalId ? { ...entry, ...patch } : entry))
  }

  const createAiDraft = async () => {
    setDrafting(true)
    try {
      const draft = await createDailyReviewDraftWithAi({ date, tasks, entries })
      setOverall(draft.overall)
      setReflection(draft.reflection)
      toast.success('AI 复盘草稿已生成，请确认后再保存')
    } catch (error) {
      toast.error('生成草稿失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setDrafting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      let input: SaveDailyReportInput = { localDate: date, overall, reflection, entries }
      if (nativeRuntime && writeMarkdown) {
        try {
          input = { ...input, markdownPath: await writeDailyReportMarkdown(input, settings.reportDirectory) }
        } catch (error) {
          toast.warning('Markdown 写入失败，结构化日报仍会保存', { description: error instanceof Error ? error.message : String(error) })
        }
      }
      const savedReport = await saveReport(input)
      await ensureTasks(nextStudyDate(date, settings.weeklyDays))
      onSaved?.(savedReport.markdownPath)
      toast.success('学习日报已保存')
    } catch (error) {
      toast.error('保存日报失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">学习日报</h1><p className="text-sm text-muted-foreground">{nativeRuntime ? '结构化数据保存在本地，Markdown 可写入当前 NoteGen 工作区。' : 'Web 测试版会把日报保存在当前浏览器。'}</p></div>
        <div className="space-y-1"><Label htmlFor="report-date">日期</Label><Input id="report-date" type="date" value={date} onChange={event => void loadDate(event.target.value)} /></div>
      </div>

      <Card>
        <CardHeader className="flex-col items-start justify-between gap-3 sm:flex-row"><div><CardTitle>总体总结</CardTitle><CardDescription>{nativeRuntime ? 'AI 只生成草稿，不会自动覆盖或保存。' : '记录今天完成的内容和实际效果。'}</CardDescription></div>{nativeRuntime ? <Button variant="outline" onClick={() => void createAiDraft()} disabled={drafting}><Sparkles data-icon="inline-start" />{drafting ? '生成中…' : 'AI 草稿'}</Button> : null}</CardHeader>
        <CardContent><Textarea value={overall} onChange={event => setOverall(event.target.value)} placeholder="今天完成了什么、效果如何？" maxRows={8} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>目标执行</CardTitle><CardDescription>专注时长会按目标自动汇总，进度由你确认。</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {entries.length ? entries.map(entry => (
            <div key={entry.goalId} className="space-y-3 rounded-lg border p-4">
              <p className="font-medium">{entry.goalTitle}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1"><Label>执行状态</Label><Select value={entry.status} onValueChange={value => updateEntry(entry.goalId, { status: value as LearningExecutionStatus })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="done">完成</SelectItem><SelectItem value="partial">部分完成</SelectItem><SelectItem value="not-done">未完成</SelectItem></SelectContent></Select></div>
                <div className="space-y-1"><Label>累计进度（%）</Label><Input type="number" min={0} max={100} value={entry.progressPercent} onChange={event => updateEntry(entry.goalId, { progressPercent: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /></div>
                <div className="space-y-1"><Label>学习分钟数</Label><Input type="number" min={0} value={entry.studyMinutes} onChange={event => updateEntry(entry.goalId, { studyMinutes: Math.max(0, Number(event.target.value) || 0) })} /></div>
              </div>
              <Textarea value={entry.content} onChange={event => updateEntry(entry.goalId, { content: event.target.value })} placeholder="学习内容、成果或未完成原因" maxRows={6} />
            </div>
          )) : <p className="py-6 text-center text-sm text-muted-foreground">当前没有可记录的学习目标。</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>学习复盘</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1"><Label>精力状态（1–5）</Label><Input type="number" min={1} max={5} value={reflection.energyLevel ?? ''} onChange={event => setReflection({ ...reflection, energyLevel: event.target.value ? Number(event.target.value) : null })} /></div>
          <div className="space-y-1"><Label>专注程度（1–5）</Label><Input type="number" min={1} max={5} value={reflection.focusLevel ?? ''} onChange={event => setReflection({ ...reflection, focusLevel: event.target.value ? Number(event.target.value) : null })} /></div>
          <div className="space-y-1"><Label>最大收获</Label><Textarea value={reflection.biggestWin} onChange={event => setReflection({ ...reflection, biggestWin: event.target.value })} /></div>
          <div className="space-y-1"><Label>主要困难</Label><Textarea value={reflection.biggestBlocker} onChange={event => setReflection({ ...reflection, biggestBlocker: event.target.value })} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>下次调整</Label><Textarea value={reflection.nextIntention} onChange={event => setReflection({ ...reflection, nextIntention: event.target.value })} /></div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        {nativeRuntime ? <label className="flex items-center gap-2 text-sm"><Checkbox checked={writeMarkdown} onCheckedChange={checked => setWriteMarkdown(checked === true)} /><FileText className="size-4" />同时写入 Markdown 日报</label> : <p className="text-sm text-muted-foreground">仅保存在此浏览器，不会写入工作区文件。</p>}
        <Button onClick={() => void handleSave()} disabled={saving || loading}>{saving ? '保存中…' : '保存日报'}</Button>
      </div>
    </div>
  )
}
