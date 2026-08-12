'use client'

import { CalendarDays, Check, Clock3, Sparkles, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import emitter from '@/lib/emitter'
import type { ToolCall } from '@/lib/agent/types'
import type { CreateLearningGoalInput } from '@/types/learning'

type GoalDraft = Pick<CreateLearningGoalInput, 'title' | 'description' | 'startDate' | 'endDate' | 'timeWeight' | 'note' | 'planMarkdown'> & {
  kind: 'learning-goal-draft'
  targetGoalId: string | null
}

function asGoalDraft(value: unknown): GoalDraft | null {
  if (!value || typeof value !== 'object') return null
  const draft = value as Record<string, unknown>
  if (draft.kind !== 'learning-goal-draft') return null
  if (!['title', 'description', 'startDate', 'endDate'].every(key => typeof draft[key] === 'string' && draft[key])) return null
  return {
    kind: 'learning-goal-draft',
    targetGoalId: typeof draft.targetGoalId === 'string' ? draft.targetGoalId : null,
    title: String(draft.title),
    description: String(draft.description),
    startDate: String(draft.startDate),
    endDate: String(draft.endDate),
    timeWeight: Math.max(1, Math.min(10, Number(draft.timeWeight) || 5)),
    note: String(draft.note || ''),
    planMarkdown: String(draft.planMarkdown || ''),
  }
}

export function getGoalDrafts(toolCalls: ToolCall[]): GoalDraft[] {
  return toolCalls
    .filter(call => call.toolName === 'learning_propose_goal' && call.status === 'success')
    .map(call => asGoalDraft(call.result?.data))
    .filter((draft): draft is GoalDraft => Boolean(draft))
    .slice(-1)
}

export function LearningGoalDraftCard({ draft }: { draft: GoalDraft }) {
  const adopt = () => {
    emitter.emit('learning-goal-draft-adopted', {
      title: draft.title,
      description: draft.description,
      startDate: draft.startDate,
      endDate: draft.endDate,
      timeWeight: draft.timeWeight,
      note: draft.note,
      planMarkdown: draft.planMarkdown,
      targetGoalId: draft.targetGoalId,
    })
  }

  const adjust = () => {
    emitter.emit('quick-prompt-insert', [
      '请基于当前草案帮我调整长期学习规划。不要直接保存；调整完成后重新调用 learning_propose_goal 生成新的待采纳草案。',
      draft.targetGoalId ? `这是已保存目标的调整，请在新草案中保留 targetGoalId：${draft.targetGoalId}` : '',
      '',
      '我的调整要求：[请在这里填写，例如缩短周期、增加项目实践、降低每天强度]',
      '',
      `当前标题：${draft.title}`,
      `当前目标：${draft.description}`,
      `当前周期：${draft.startDate} 至 ${draft.endDate}`,
      `当前时间权重：${draft.timeWeight}/10`,
      '当前总体路线：',
      draft.planMarkdown,
      draft.note ? `\n当前执行建议：\n${draft.note}` : '',
    ].filter(Boolean).join('\n'))
  }

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary"><Target className="size-4" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">{draft.targetGoalId ? '目标调整草案' : '学习目标草案'}</p>
          <h3 className="mt-0.5 font-semibold">{draft.title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{draft.description}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-y py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><CalendarDays className="size-3.5" />{draft.startDate} 至 {draft.endDate}</span>
        <span className="flex items-center gap-1.5"><Clock3 className="size-3.5" />时间权重 {draft.timeWeight}/10</span>
      </div>
      {draft.note ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{draft.note}</p> : null}
      {draft.planMarkdown ? <div className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm leading-6">{draft.planMarkdown}</div> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={adjust}><Sparkles />AI 调整</Button>
        <Button size="sm" onClick={adopt}><Check />采用此方案</Button>
      </div>
    </div>
  )
}
