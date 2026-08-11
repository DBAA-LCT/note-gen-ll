'use client'

import { useEffect, useMemo, useState } from 'react'
import { Archive, ArrowRight, CalendarDays, CheckCircle2, Clock3, MoreHorizontal, Pencil, Plus, RotateCcw, Target, TimerReset, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { diffLocalDays, formatLocalDate } from '@/lib/learning/date'
import { listLearningTasksForGoal } from '@/lib/learning/repository'
import { cn } from '@/lib/utils'
import useLearningStore from '@/stores/learning'
import type { LearningGoal, LearningGoalStatus, LearningTask } from '@/types/learning'
import { GoalDialog } from './goal-dialog'

const statusLabel: Record<LearningGoalStatus, string> = { planned: '待开始', active: '进行中', completed: '已完成', archived: '已归档', deleted: '已删除' }

export function GoalsView({ createSignal = 0, onNavigate }: { createSignal?: number; onNavigate?: (value: 'today' | 'focus') => void }) {
  const { goals, settings, setGoalStatus } = useLearningStore()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState<LearningGoal | undefined>()
  const [tasksByGoal, setTasksByGoal] = useState<Record<string, LearningTask[]>>({})
  const [lastSignal, setLastSignal] = useState(createSignal)

  useEffect(() => {
    let cancelled = false
    void Promise.all(goals.map(async goal => [goal.id, await listLearningTasksForGoal(goal.id)] as const)).then(entries => {
      if (!cancelled) setTasksByGoal(Object.fromEntries(entries))
    })
    return () => { cancelled = true }
  }, [goals])

  useEffect(() => {
    if (createSignal !== lastSignal) {
      setLastSignal(createSignal)
      setEditingGoal(undefined)
      setDialogOpen(true)
    }
  }, [createSignal, lastSignal])

  const today = formatLocalDate(Date.now(), settings.timeZone)
  const activeGoals = goals.filter(goal => goal.status === 'active' || goal.status === 'planned')
  const finishedGoals = goals.filter(goal => goal.status === 'completed' || goal.status === 'archived')
  const totalTasks = useMemo(() => Object.values(tasksByGoal).flat().filter(task => task.status !== 'cancelled'), [tasksByGoal])
  const doneTasks = totalTasks.filter(task => task.status === 'done').length

  const changeStatus = async (goal: LearningGoal, status: LearningGoalStatus) => {
    if (status === 'deleted' && !window.confirm(`删除目标“${goal.title}”？历史日报和专注记录会保留。`)) return
    await setGoalStatus(goal.id, status)
    toast.success(status === 'deleted' ? '目标已删除' : '目标状态已更新')
  }

  const openEdit = (goal?: LearningGoal) => { setEditingGoal(goal); setDialogOpen(true) }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-semibold tracking-tight">目标总览</h1><p className="mt-1 text-sm text-muted-foreground">查看长期进度、截止风险和最近执行记录，不再把目标与每日任务拆成两套逻辑。</p></div>
        <div className="flex gap-2"><Button variant="outline" onClick={() => onNavigate?.('today')}>回到今日</Button><Button onClick={() => openEdit()}><Plus />新建目标</Button></div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">进行中</p><p className="mt-1 text-2xl font-semibold">{activeGoals.length} 个目标</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">累计任务</p><p className="mt-1 text-2xl font-semibold">{doneTasks} / {totalTasks.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">已完成与归档</p><p className="mt-1 text-2xl font-semibold">{finishedGoals.length} 个目标</p></CardContent></Card>
      </div>

      {activeGoals.length ? (
        <div>
          <div className="mb-3 text-sm font-medium text-muted-foreground">当前目标</div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {activeGoals.map(goal => <GoalBoardCard key={goal.id} goal={goal} tasks={tasksByGoal[goal.id] || []} today={today} onEdit={() => openEdit(goal)} onStatus={status => void changeStatus(goal, status)} onFocus={() => onNavigate?.('focus')} />)}
          </div>
        </div>
      ) : (
        <Card><CardContent className="flex flex-col items-center gap-3 py-14 text-center"><Target className="size-11 text-muted-foreground" /><div><p className="font-medium">还没有进行中的学习目标</p><p className="text-sm text-muted-foreground">创建目标后，NoteGen 会按每日预算自动安排任务。</p></div><Button onClick={() => openEdit()}>创建第一个目标</Button></CardContent></Card>
      )}

      {finishedGoals.length ? (
        <Card>
          <CardHeader><CardTitle className="text-base">已完成与归档</CardTitle><CardDescription>历史目标仍会保留在日报、周报和笔记关联中。</CardDescription></CardHeader>
          <CardContent className="divide-y">{finishedGoals.map(goal => <div key={goal.id} className="flex items-center gap-3 py-3"><span className="size-2.5 rounded-full" style={{ backgroundColor: goal.color }} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{goal.title}</span><Badge variant="outline">{statusLabel[goal.status]}</Badge><Button size="icon-sm" variant="ghost" onClick={() => void changeStatus(goal, 'active')} aria-label="重新开启"><RotateCcw /></Button></div>)}</CardContent>
        </Card>
      ) : null}

      <GoalDialog open={dialogOpen} onOpenChange={setDialogOpen} goal={editingGoal} />
    </div>
  )
}

function GoalBoardCard({ goal, tasks, today, onEdit, onStatus, onFocus }: { goal: LearningGoal; tasks: LearningTask[]; today: string; onEdit: () => void; onStatus: (status: LearningGoalStatus) => void; onFocus: () => void }) {
  const activeTasks = tasks.filter(task => task.status !== 'cancelled')
  const done = activeTasks.filter(task => task.status === 'done')
  const investedMinutes = done.reduce((sum, task) => sum + task.plannedMinutes, 0)
  const remainingDays = Math.max(0, diffLocalDays(today, goal.endDate))
  const recent = activeTasks.slice(0, 4)
  const overdue = goal.endDate < today

  return (
    <Card className={cn('overflow-hidden', overdue && 'border-destructive/30')}>
      <div className="h-1.5" style={{ backgroundColor: goal.color }} />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><CardTitle className="truncate text-base">{goal.title}</CardTitle><Badge variant={overdue ? 'destructive' : 'outline'}>{overdue ? '已逾期' : statusLabel[goal.status]}</Badge></div><CardDescription className="mt-1 line-clamp-2">{goal.description}</CardDescription></div>
          <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={onEdit}><Pencil />编辑目标</DropdownMenuItem><DropdownMenuItem onClick={() => onStatus('completed')}><CheckCircle2 />标记完成</DropdownMenuItem><DropdownMenuItem onClick={() => onStatus('archived')}><Archive />归档</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => onStatus('deleted')}><Trash2 />删除</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div><div className="mb-2 flex justify-between text-sm"><span className="text-muted-foreground">累计进度</span><strong>{Math.round(goal.progressPercent)}%</strong></div><Progress value={goal.progressPercent} /></div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-muted/50 p-2"><CalendarDays className="mx-auto size-4 text-muted-foreground" /><p className="mt-1 text-sm font-semibold">{remainingDays}</p><p className="text-[11px] text-muted-foreground">剩余天数</p></div>
          <div className="rounded-md bg-muted/50 p-2"><CheckCircle2 className="mx-auto size-4 text-muted-foreground" /><p className="mt-1 text-sm font-semibold">{done.length}/{activeTasks.length}</p><p className="text-[11px] text-muted-foreground">任务完成</p></div>
          <div className="rounded-md bg-muted/50 p-2"><Clock3 className="mx-auto size-4 text-muted-foreground" /><p className="mt-1 text-sm font-semibold">{investedMinutes}m</p><p className="text-[11px] text-muted-foreground">计划投入</p></div>
        </div>
        {goal.note ? <div className="rounded-md border-l-2 bg-muted/30 px-3 py-2 text-xs text-muted-foreground" style={{ borderColor: goal.color }}>{goal.note}</div> : null}
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">最近任务</p>
          <div className="space-y-1.5">{recent.length ? recent.map(task => <div key={task.id} className="flex items-center gap-2 text-xs"><span className={cn('size-1.5 rounded-full', task.status === 'done' ? 'bg-emerald-500' : 'bg-muted-foreground/30')} /><span className={cn('min-w-0 flex-1 truncate', task.status === 'done' && 'text-muted-foreground line-through')}>{task.title}</span><span className="text-muted-foreground">{task.localDate}</span></div>) : <p className="text-xs text-muted-foreground">还没有生成任务。</p>}</div>
        </div>
        <div className="flex gap-2 border-t pt-3"><Button size="sm" onClick={onFocus}><TimerReset />开始专注</Button><Button size="sm" variant="outline" onClick={onEdit}>调整计划<ArrowRight /></Button></div>
      </CardContent>
    </Card>
  )
}
