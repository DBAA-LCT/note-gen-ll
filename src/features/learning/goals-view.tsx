'use client'

import { useEffect, useMemo, useState } from 'react'
import MarkdownIt from 'markdown-it'
import { Archive, CalendarDays, CheckCircle2, MoreHorizontal, Pencil, Plus, RotateCcw, Sparkles, Target, TimerReset, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { diffLocalDays, formatLocalDate } from '@/lib/learning/date'
import { listLearningTasksForGoal } from '@/lib/learning/repository'
import { cn } from '@/lib/utils'
import useLearningStore from '@/stores/learning'
import { useSidebarStore } from '@/stores/sidebar'
import type { CreateLearningGoalInput, LearningGoal, LearningGoalStatus, LearningTask } from '@/types/learning'
import { GoalDialog } from './goal-dialog'
import emitter from '@/lib/emitter'

const statusLabel: Record<LearningGoalStatus, string> = { planned: '待开始', active: '进行中', completed: '已完成', archived: '已归档', deleted: '已删除' }

const planMarkdown = new MarkdownIt({ html: false, linkify: true, typographer: true })

function planPreview(markdown: string) {
  return markdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

export function GoalsView({ createSignal = 0, onCreateRequestHandled, onNavigate }: { createSignal?: number; onCreateRequestHandled?: () => void; onNavigate?: (value: 'today' | 'focus') => void }) {
  const { goals, settings, setGoalStatus } = useLearningStore()
  const { rightSidebarVisible, toggleRightSidebar } = useSidebarStore()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [createChoiceOpen, setCreateChoiceOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState<LearningGoal | undefined>()
  const [goalDraft, setGoalDraft] = useState<Partial<CreateLearningGoalInput> | undefined>()
  const [viewingGoal, setViewingGoal] = useState<LearningGoal | undefined>()
  const [tasksByGoal, setTasksByGoal] = useState<Record<string, LearningTask[]>>({})
  const [lastSignal, setLastSignal] = useState(0)

  useEffect(() => {
    let cancelled = false
    void Promise.all(goals.map(async goal => [goal.id, await listLearningTasksForGoal(goal.id)] as const)).then(entries => {
      if (!cancelled) setTasksByGoal(Object.fromEntries(entries))
    })
    return () => { cancelled = true }
  }, [goals])

  useEffect(() => {
    if (createSignal > 0 && createSignal !== lastSignal) {
      setLastSignal(createSignal)
      setEditingGoal(undefined)
      setGoalDraft(undefined)
      setCreateChoiceOpen(true)
      onCreateRequestHandled?.()
    }
  }, [createSignal, lastSignal, onCreateRequestHandled])

  useEffect(() => {
    const adoptDraft = (draft: Partial<CreateLearningGoalInput> & { targetGoalId?: string | null }) => {
      const { targetGoalId, ...formDraft } = draft
      setEditingGoal(targetGoalId ? goals.find(goal => goal.id === targetGoalId) : undefined)
      setGoalDraft(formDraft)
      setDialogOpen(true)
    }
    emitter.on('learning-goal-draft-adopted', adoptDraft)
    return () => emitter.off('learning-goal-draft-adopted', adoptDraft)
  }, [goals])

  const today = formatLocalDate(Date.now(), settings.timeZone)
  const activeGoals = goals.filter(goal => goal.status === 'active' || goal.status === 'planned')
  const finishedGoals = goals.filter(goal => goal.status === 'completed' || goal.status === 'archived')
  const changeStatus = async (goal: LearningGoal, status: LearningGoalStatus) => {
    if (status === 'deleted' && !window.confirm(`删除目标“${goal.title}”？过去的每日回顾和执行记录会保留。`)) return
    await setGoalStatus(goal.id, status)
    toast.success(status === 'deleted' ? '目标已删除' : '目标状态已更新')
  }

  const openEdit = (goal?: LearningGoal) => { setEditingGoal(goal); setGoalDraft(undefined); setDialogOpen(true) }
  const openManualCreate = () => { setCreateChoiceOpen(false); openEdit() }

  const openAiPlanner = async () => {
    setCreateChoiceOpen(false)
    const activeGoalSummary = activeGoals.length
      ? activeGoals.map(goal => `- ${goal.title}（${goal.startDate} 至 ${goal.endDate}）`).join('\n')
      : '暂无进行中的目标'
    const prompt = `请通过访谈帮我新建一个长期目标。访谈时每一轮都必须调用 learning_ask_interview_question，只问一个可以独立回答的简短问题，然后停下来等待我的回答；不得改用普通正文提出访谈问题，也绝对不要在一轮里列出多个子问题或让我按题号逐项作答。每道题提供 2–5 个选项：方向、期限、现状、偏好等封闭式问题使用 answerMode="direct"，点击选项直接回答；需要用户详细描述的开放式问题使用 answerMode="draft"，AI 生成几个自然的第一人称回答草稿，点击后只覆盖输入框，让我编辑后再发送。同时允许完全自由回答。你需要记住我已经说过的信息，不要让我复述问题或重复回答。逐步了解：我最终想达到什么结果、准备什么时候完成、当前现状与可投入时间、偏好的推进方式和现实限制。不要一开始就给方案。信息充分后停止提问，先设计一份有先后依赖关系的总体路线，每个阶段写明目标、里程碑和进入下一阶段的标准；然后调用 learning_propose_goal 生成待采纳的目标草案卡片，不要直接创建目标。我可以继续通过对话要求你调整路线，满意后才会点击“采用此方案”并在表单中保存。\n\n当前每日可投入时间：${settings.dailyStudyMinutes} 分钟\n当前进行中的目标：\n${activeGoalSummary}`
    if (!rightSidebarVisible) await toggleRightSidebar()
    window.setTimeout(() => emitter.emit('quick-prompt-insert', prompt), 120)
  }

  const openAiGoalAdjustment = async (goal: LearningGoal) => {
    const prompt = [
      `请帮我调整已保存的长期目标“${goal.title}”。先根据我的修改要求调整总体路线；如果要求不明确，可以使用 learning_ask_interview_question 一次询问一个必要问题。方案确定后调用 learning_propose_goal 生成新的待采纳草案，不要直接修改目标，并且必须在草案中保留 targetGoalId：${goal.id}。`,
      '',
      '我的调整要求：[请在这里填写，例如增加实战项目、延长一个月、降低推进强度]',
      '',
      `当前目标：${goal.description}`,
      `当前周期：${goal.startDate} 至 ${goal.endDate}`,
      `当前时间权重：${goal.timeWeight}/10`,
      '当前总体路线：',
      goal.planMarkdown || '尚未设置总体路线',
      goal.note ? `\n当前执行建议：\n${goal.note}` : '',
    ].filter(Boolean).join('\n')
    if (!rightSidebarVisible) await toggleRightSidebar()
    window.setTimeout(() => emitter.emit('quick-prompt-insert', prompt), 120)
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-semibold tracking-tight">目标</h1><p className="mt-1 text-sm text-muted-foreground">用一条清晰路线串起笔记和每天要做的事。</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => onNavigate?.('today')}>回到今日</Button><Button onClick={() => setCreateChoiceOpen(true)}><Plus />创建目标</Button></div>
      </div>

      {activeGoals.length ? (
        <div>
          <div className="mb-3 text-sm font-medium text-muted-foreground">当前目标</div>
          <div className="grid gap-4">
            {activeGoals.map(goal => <GoalBoardCard key={goal.id} goal={goal} tasks={tasksByGoal[goal.id] || []} today={today} onViewPlan={() => setViewingGoal(goal)} onEdit={() => openEdit(goal)} onAiAdjust={() => void openAiGoalAdjustment(goal)} onStatus={status => void changeStatus(goal, status)} onFocus={() => onNavigate?.('focus')} />)}
          </div>
        </div>
      ) : (
        <Card><CardContent className="flex flex-col items-center gap-3 py-14 text-center"><Target className="size-11 text-muted-foreground" /><div><p className="font-medium">先告诉 NoteGen 你想完成什么</p><p className="text-sm text-muted-foreground">创建目标后，再由 AI 和你一起安排每天要做的事情。</p></div><Button onClick={() => setCreateChoiceOpen(true)}>创建第一个目标</Button></CardContent></Card>
      )}

      {finishedGoals.length ? (
        <Card>
          <CardHeader><CardTitle className="text-base">过去的目标</CardTitle><CardDescription>完成或归档后，相关回顾和笔记仍会保留。</CardDescription></CardHeader>
          <CardContent className="divide-y">{finishedGoals.map(goal => <div key={goal.id} className="flex items-center gap-3 py-3"><span className="min-w-0 flex-1 truncate text-sm font-medium">{goal.title}</span><Badge variant="outline">{statusLabel[goal.status]}</Badge><Button size="icon-sm" variant="ghost" onClick={() => void changeStatus(goal, 'active')} aria-label="重新开启"><RotateCcw /></Button></div>)}</CardContent>
        </Card>
      ) : null}

      <GoalDialog open={dialogOpen} onOpenChange={setDialogOpen} goal={editingGoal} draft={goalDraft} />
      <GoalPlanDialog
        goal={viewingGoal}
        open={!!viewingGoal}
        onOpenChange={open => { if (!open) setViewingGoal(undefined) }}
        onEdit={() => {
          const goal = viewingGoal
          setViewingGoal(undefined)
          if (goal) openEdit(goal)
        }}
      />
      <Dialog open={createChoiceOpen} onOpenChange={setCreateChoiceOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>创建目标</DialogTitle><DialogDescription>选择适合你的方式。第一次使用建议让 AI 带着你完成。</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" className="rounded-xl border bg-primary/5 p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/10" onClick={() => void openAiPlanner()}>
              <Sparkles className="size-5 text-primary" />
              <p className="mt-3 font-medium">AI 引导创建</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">回答几个简单问题，生成可调整的总体路线。</p>
              <Badge className="mt-3">推荐</Badge>
            </button>
            <button type="button" className="rounded-xl border p-4 text-left transition-colors hover:bg-muted/50" onClick={openManualCreate}>
              <Pencil className="size-5 text-muted-foreground" />
              <p className="mt-3 font-medium">自己填写</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">已经想清楚目标和周期时，直接填写表单。</p>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function GoalBoardCard({ goal, tasks, today, onViewPlan, onEdit, onAiAdjust, onStatus, onFocus }: { goal: LearningGoal; tasks: LearningTask[]; today: string; onViewPlan: () => void; onEdit: () => void; onAiAdjust: () => void; onStatus: (status: LearningGoalStatus) => void; onFocus: () => void }) {
  const activeTasks = tasks.filter(task => task.status !== 'cancelled')
  const remainingDays = Math.max(0, diffLocalDays(today, goal.endDate))
  const nextTask = activeTasks.find(task => task.status !== 'done')
  const overdue = goal.endDate < today

  return (
    <Card className={cn('overflow-hidden', overdue && 'border-destructive/30')}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><CardTitle className="truncate text-base">{goal.title}</CardTitle><Badge variant={overdue ? 'destructive' : 'outline'}>{overdue ? '已逾期' : statusLabel[goal.status]}</Badge></div><CardDescription className="mt-1 line-clamp-2">{goal.description}</CardDescription></div>
          <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={onEdit}><Pencil />手动编辑</DropdownMenuItem><DropdownMenuItem onClick={onAiAdjust}><Sparkles />AI 调整路线</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => onStatus('completed')}><CheckCircle2 />标记完成</DropdownMenuItem><DropdownMenuItem onClick={() => onStatus('archived')}><Archive />归档</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => onStatus('deleted')}><Trash2 />删除</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div><div className="mb-2 flex justify-between text-sm"><span className="text-muted-foreground">累计进度</span><strong>{Math.round(goal.progressPercent)}%</strong></div><Progress value={goal.progressPercent} /></div>
        {goal.planMarkdown ? <div className="rounded-md bg-muted/40 p-3"><p className="mb-1 text-xs font-medium text-muted-foreground">总体路线</p><p className="line-clamp-4 whitespace-pre-line text-xs leading-5">{planPreview(goal.planMarkdown)}</p></div> : null}
        <div className="flex items-center justify-between text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><CalendarDays className="size-3.5" />{goal.endDate} 前完成</span><span>{overdue ? '已超过计划日期' : `还有 ${remainingDays} 天`}</span></div>
        <div className="rounded-md border bg-background p-3"><p className="text-xs font-medium text-muted-foreground">下一步</p>{nextTask ? <><div className="mt-1 flex items-center justify-between gap-3"><p className="min-w-0 truncate text-sm font-medium">{nextTask.title}</p><span className="shrink-0 text-xs font-medium">{Math.round(nextTask.progressPercent)}%</span></div><Progress value={nextTask.progressPercent} className="mt-2 h-1" /><p className="mt-1 text-xs text-muted-foreground">{nextTask.localDate}</p></> : <p className="mt-1 text-sm text-muted-foreground">还没有安排下一项任务。</p>}</div>
        <div className="flex gap-2 border-t pt-3"><Button size="sm" onClick={onFocus}><TimerReset />开始执行</Button><Button size="sm" variant="outline" onClick={onViewPlan}>查看规划</Button></div>
      </CardContent>
    </Card>
  )
}

function GoalPlanDialog({ goal, open, onOpenChange, onEdit }: { goal?: LearningGoal; open: boolean; onOpenChange: (open: boolean) => void; onEdit: () => void }) {
  const renderedPlan = useMemo(() => planMarkdown.render(goal?.planMarkdown || ''), [goal?.planMarkdown])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{goal?.title || '总体规划'}</DialogTitle>
          <DialogDescription>{goal?.description}</DialogDescription>
        </DialogHeader>
        {goal?.note ? (
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-xs font-medium text-muted-foreground">执行建议</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-6">{goal.note}</p>
          </div>
        ) : null}
        {renderedPlan ? (
          <article
            className="text-sm leading-7 text-foreground [&_h1]:mb-4 [&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-3 [&_h2]:mt-7 [&_h2]:border-b [&_h2]:pb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_strong]:font-semibold [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6"
            dangerouslySetInnerHTML={{ __html: renderedPlan }}
          />
        ) : (
          <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">还没有总体规划。</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button onClick={onEdit}><Pencil />编辑规划</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
