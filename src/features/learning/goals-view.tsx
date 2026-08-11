'use client'

import { useEffect, useMemo, useState } from 'react'
import { Archive, CalendarDays, CheckCircle2, Clock3, MoreHorizontal, Pencil, Plus, RotateCcw, Target, Trash2 } from 'lucide-react'
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

export function GoalsView({ createSignal = 0 }: { createSignal?: number }) {
  const { goals, settings, setGoalStatus } = useLearningStore()
  const [selectedId, setSelectedId] = useState<string>('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState<LearningGoal | undefined>()
  const [goalTasks, setGoalTasks] = useState<LearningTask[]>([])
  const [lastSignal, setLastSignal] = useState(createSignal)
  const selected = goals.find(goal => goal.id === selectedId) || goals[0]

  useEffect(() => { if (!selectedId && goals[0]) setSelectedId(goals[0].id) }, [goals, selectedId])
  useEffect(() => { if (selected) void listLearningTasksForGoal(selected.id).then(setGoalTasks) }, [selected?.id])
  useEffect(() => { if (createSignal !== lastSignal) { setLastSignal(createSignal); setEditingGoal(undefined); setDialogOpen(true) } }, [createSignal, lastSignal])

  const today = formatLocalDate(Date.now(), settings.timeZone)
  const remainingDays = selected ? Math.max(0, diffLocalDays(today, selected.endDate)) : 0
  const activeTasks = goalTasks.filter(task => task.status !== 'cancelled')
  const doneTasks = activeTasks.filter(task => task.status === 'done')
  const investedMinutes = activeTasks.filter(task => task.status === 'done').reduce((sum, task) => sum + task.plannedMinutes, 0)
  const recentTasks = useMemo(() => activeTasks.slice(0, 12), [activeTasks])

  const changeStatus = async (goal: LearningGoal, status: LearningGoalStatus) => {
    if (status === 'deleted' && !window.confirm(`删除目标“${goal.title}”？历史日报和专注记录会保留。`)) return
    await setGoalStatus(goal.id, status)
    toast.success(status === 'deleted' ? '目标已删除' : '目标状态已更新')
  }

  const openEdit = (goal?: LearningGoal) => { setEditingGoal(goal); setDialogOpen(true) }

  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">学习目标</h1><p className="text-sm text-muted-foreground">从长期目标进入每日任务，进度由复盘记录持续更新。</p></div><Button onClick={() => openEdit()}><Plus />新建目标</Button></div>
    {goals.length ? <div className="grid min-h-[560px] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="h-fit overflow-hidden"><CardHeader className="border-b"><CardTitle className="text-base">目标列表</CardTitle><CardDescription>{goals.length} 个目标</CardDescription></CardHeader><CardContent className="space-y-1 p-2">{goals.map(goal => <button key={goal.id} type="button" onClick={() => setSelectedId(goal.id)} className={cn('w-full rounded-lg p-3 text-left transition-colors hover:bg-muted', selected?.id === goal.id && 'bg-muted')}><div className="flex items-center gap-2"><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: goal.color }} /><span className="min-w-0 flex-1 truncate font-medium">{goal.title}</span><span className="text-xs tabular-nums text-muted-foreground">{Math.round(goal.progressPercent)}%</span></div><Progress value={goal.progressPercent} className="mt-2 h-1" /><div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>{statusLabel[goal.status]}</span><span>{goal.endDate}</span></div></button>)}</CardContent></Card>
      {selected ? <div className="space-y-4"><Card className="overflow-hidden"><div className="h-1.5" style={{ backgroundColor: selected.color }} /><CardHeader><div className="flex items-start justify-between gap-3"><div><div className="mb-2 flex flex-wrap gap-2"><Badge>{statusLabel[selected.status]}</Badge><Badge variant="outline">权重 {selected.timeWeight}</Badge></div><CardTitle className="text-2xl">{selected.title}</CardTitle><CardDescription className="mt-2 max-w-3xl text-sm">{selected.description}</CardDescription></div><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => openEdit(selected)}><Pencil />编辑目标</DropdownMenuItem>{(selected.status === 'active' || selected.status === 'planned') && <DropdownMenuItem onClick={() => void changeStatus(selected, 'completed')}><CheckCircle2 />标记完成</DropdownMenuItem>}{(selected.status === 'active' || selected.status === 'planned') && <DropdownMenuItem onClick={() => void changeStatus(selected, 'archived')}><Archive />归档</DropdownMenuItem>}{(selected.status === 'completed' || selected.status === 'archived') && <DropdownMenuItem onClick={() => void changeStatus(selected, 'active')}><RotateCcw />重新开启</DropdownMenuItem>}<DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => void changeStatus(selected, 'deleted')}><Trash2 />删除</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></CardHeader><CardContent className="space-y-5"><div><div className="mb-2 flex justify-between text-sm"><span>累计进度</span><strong>{Math.round(selected.progressPercent)}%</strong></div><Progress value={selected.progressPercent} /></div><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg border p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5" />时间范围</p><p className="mt-1 font-medium">{selected.startDate} 至 {selected.endDate}</p><p className="text-xs text-muted-foreground">剩余 {remainingDays} 天</p></div><div className="rounded-lg border p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="size-3.5" />任务完成</p><p className="mt-1 text-xl font-semibold">{doneTasks.length} / {activeTasks.length}</p></div><div className="rounded-lg border p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3.5" />已投入</p><p className="mt-1 text-xl font-semibold">{Math.floor(investedMinutes / 60)}h {investedMinutes % 60}m</p></div></div>{selected.note ? <div className="rounded-lg bg-muted/40 p-4"><p className="mb-1 text-xs font-medium text-muted-foreground">执行备注</p><p className="whitespace-pre-wrap text-sm">{selected.note}</p></div> : null}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">任务轨迹</CardTitle><CardDescription>最近生成和完成的任务，按日期倒序排列。</CardDescription></CardHeader><CardContent className="space-y-2">{recentTasks.length ? recentTasks.map(task => <div key={task.id} className="flex items-center gap-3 rounded-lg border p-3"><span className={cn('size-2 shrink-0 rounded-full', task.status === 'done' ? 'bg-emerald-500' : task.status === 'in-progress' ? 'bg-amber-500' : 'bg-muted-foreground/30')} /><div className="min-w-0 flex-1"><p className={cn('truncate text-sm font-medium', task.status === 'done' && 'text-muted-foreground line-through')}>{task.title}</p><p className="text-xs text-muted-foreground">{task.localDate} · {task.plannedMinutes} 分钟</p></div><Badge variant="outline">{task.status === 'done' ? '完成' : task.status === 'in-progress' ? '进行中' : '待办'}</Badge></div>) : <div className="py-10 text-center text-sm text-muted-foreground">该目标还没有生成任务。</div>}</CardContent></Card></div> : null}
    </div> : <Card><CardContent className="flex flex-col items-center gap-3 py-16 text-center"><Target className="size-11 text-muted-foreground" /><div><p className="font-medium">还没有学习目标</p><p className="text-sm text-muted-foreground">创建目标后，NoteGen 会按每日预算生成可执行任务。</p></div><Button onClick={() => openEdit()}>创建第一个目标</Button></CardContent></Card>}
    <GoalDialog open={dialogOpen} onOpenChange={setDialogOpen} goal={editingGoal} />
  </div>
}
