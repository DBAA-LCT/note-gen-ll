'use client'

import { CalendarCheck2, Check, ClipboardList, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import emitter from '@/lib/emitter'
import type { ToolCall } from '@/lib/agent/types'
import type { AiLearningTaskDraft, DailyReflection, DailyReportGoalEntry } from '@/types/learning'

interface DailyPlanDraft {
  kind: 'learning-daily-plan-draft'
  date: string
  basedOnDate: string | null
  rationale: string
  tasks: AiLearningTaskDraft[]
}

interface DailyReportDraft {
  kind: 'learning-daily-report-draft'
  date: string
  scope: 'single-goal' | 'whole-day'
  overall: string
  reflection: DailyReflection
  entries: DailyReportGoalEntry[]
}

function objectsFromToolCalls(toolCalls: ToolCall[]) {
  return toolCalls.filter(call => call.status === 'success' && call.result?.data && typeof call.result.data === 'object').map(call => call.result!.data as Record<string, unknown>)
}

export function getDailyPlanDrafts(toolCalls: ToolCall[]): DailyPlanDraft[] {
  return objectsFromToolCalls(toolCalls).filter(value => value.kind === 'learning-daily-plan-draft').map(value => value as unknown as DailyPlanDraft).slice(-1)
}

export function getDailyReportDrafts(toolCalls: ToolCall[]): DailyReportDraft[] {
  return objectsFromToolCalls(toolCalls).filter(value => value.kind === 'learning-daily-report-draft').map(value => value as unknown as DailyReportDraft).slice(-1)
}

export function DailyPlanDraftCard({ draft }: { draft: DailyPlanDraft }) {
  const adjust = () => emitter.emit('quick-prompt-insert', [
    `请帮我调整 ${draft.date} 的今日计划。不要直接写入任务；调整完成后重新调用 learning_propose_daily_plan 生成新的待采纳卡片。`,
    '',
    '我的调整要求：[请在这里填写，例如减少总时长、替换某项任务、先实践再看理论]',
    '',
    `当前设计思路：${draft.rationale}`,
    '当前任务：',
    ...draft.tasks.map((task, index) => `${index + 1}. ${task.title}（${task.plannedMinutes} 分钟）\n   ${task.description}\n   完成标准：${task.completionCriteria}\n   goalId: ${task.goalId}`),
  ].join('\n'))

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3"><div className="rounded-md bg-primary/10 p-2 text-primary"><ClipboardList className="size-4" /></div><div><p className="text-xs font-medium text-muted-foreground">{draft.date} 今日计划草案</p><p className="mt-1 text-sm leading-6">{draft.rationale}</p></div></div>
      <div className="mt-3 space-y-2 border-y py-3">{draft.tasks.map((task, index) => <div key={`${task.goalId}-${index}`} className="flex gap-3 text-sm"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-xs">{index + 1}</span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><p className="font-medium">{task.title}</p>{task.plannedMinutes > 0 ? <span className="shrink-0 text-[11px] text-muted-foreground/70">预计 {task.plannedMinutes} 分钟</span> : null}</div><p className="text-xs leading-5 text-muted-foreground">{task.description}</p><p className="text-xs leading-5 text-muted-foreground">完成标准：{task.completionCriteria}</p></div></div>)}</div>
      <div className="mt-4 flex justify-end gap-2"><Button size="sm" variant="outline" onClick={adjust}><Sparkles />AI 调整</Button><Button size="sm" onClick={() => emitter.emit('learning-daily-plan-adopted', { date: draft.date, basedOnDate: draft.basedOnDate, tasks: draft.tasks })}><Check />采用今日计划</Button></div>
    </div>
  )
}

export function DailyReportDraftCard({ draft }: { draft: DailyReportDraft }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3"><div className="rounded-md bg-emerald-500/10 p-2 text-emerald-600"><CalendarCheck2 className="size-4" /></div><div><p className="text-xs font-medium text-muted-foreground">{draft.date} · {draft.scope === 'single-goal' ? '单目标' : '整日'}日报草案</p>{draft.overall ? <p className="mt-1 text-sm leading-6">{draft.overall}</p> : null}</div></div>
      <div className="mt-3 space-y-2 border-y py-3">{draft.entries.map(entry => <div key={entry.goalId} className="rounded-md bg-muted/40 p-2.5"><div className="flex items-center justify-between gap-3 text-sm"><strong>{entry.goalTitle}</strong><span className="text-xs text-muted-foreground">{entry.studyMinutes} 分钟 · {Math.round(entry.progressPercent)}%</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{entry.content}</p></div>)}</div>
      <div className="mt-4 flex justify-end"><Button size="sm" onClick={() => emitter.emit('learning-daily-report-adopted', { date: draft.date, overall: draft.overall, reflection: draft.reflection, entries: draft.entries })}><Check />采用日报草案</Button></div>
    </div>
  )
}
