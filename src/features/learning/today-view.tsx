'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CalendarClock, Check, CheckCircle2, Clock3, FileText, Flame, Link2, Plus, Target, TimerReset } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { formatChineseDate, formatLocalDate } from '@/lib/learning/date'
import { listLearningScheduleEvents } from '@/lib/learning/repository'
import { isTauriRuntime } from '@/lib/check'
import { cn } from '@/lib/utils'
import useLearningStore from '@/stores/learning'
import type { LearningGoal, LearningScheduleEvent, LearningTask } from '@/types/learning'
import { MaimemoProgressCard } from './maimemo-progress-card'

type TodayNavigation = 'focus' | 'reports' | 'calendar' | 'goals'

function goalStatus(goal: LearningGoal, date: string) {
  if (goal.status === 'completed' || goal.progressPercent >= 100) return { label: '已达成', tone: 'success' as const }
  if (goal.endDate < date) return { label: `已逾期`, tone: 'danger' as const }
  const start = new Date(`${goal.startDate}T12:00:00`).getTime()
  const end = new Date(`${goal.endDate}T12:00:00`).getTime()
  const now = new Date(`${date}T12:00:00`).getTime()
  const expected = end <= start ? 100 : Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100))
  if (goal.progressPercent + 10 < expected) return { label: '进度偏慢', tone: 'warning' as const }
  return { label: '按计划进行', tone: 'neutral' as const }
}

function GoalTodayCard({
  goal,
  tasks,
  date,
  onTaskChange,
  onFocus,
  onOpenNote,
}: {
  goal: LearningGoal
  tasks: LearningTask[]
  date: string
  onTaskChange: (id: string, done: boolean) => Promise<void>
  onFocus: () => void
  onOpenNote?: (path: string) => void
}) {
  const [finishing, setFinishing] = useState(false)
  const status = goalStatus(goal, date)
  const done = tasks.filter(task => task.status === 'done').length
  const plannedMinutes = tasks.reduce((sum, task) => sum + task.plannedMinutes, 0)
  const remainingDays = Math.max(0, Math.ceil((new Date(`${goal.endDate}T12:00:00`).getTime() - new Date(`${date}T12:00:00`).getTime()) / 86400000))

  const finishAll = async () => {
    setFinishing(true)
    try {
      for (const task of tasks.filter(item => item.status !== 'done')) await onTaskChange(task.id, true)
      toast.success(`“${goal.title}”今天的任务已完成`)
    } finally {
      setFinishing(false)
    }
  }

  return (
    <Card className={cn('overflow-hidden', status.tone === 'danger' && 'border-destructive/30', status.tone === 'warning' && 'border-amber-500/30')}>
      <div className="h-1" style={{ backgroundColor: goal.color }} />
      <CardHeader className="gap-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="truncate text-base">{goal.title}</CardTitle>
              <Badge variant={status.tone === 'danger' ? 'destructive' : 'outline'} className={cn(status.tone === 'success' && 'border-emerald-500/30 text-emerald-600', status.tone === 'warning' && 'border-amber-500/30 text-amber-600')}>{status.label}</Badge>
            </div>
            <CardDescription className="mt-1 line-clamp-2">{goal.description}</CardDescription>
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums">{Math.round(goal.progressPercent)}%</span>
        </div>
        <Progress value={goal.progressPercent} className="h-1.5" />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><CheckCircle2 className="size-3.5" />今日 {done}/{tasks.length}</span>
          <span className="flex items-center gap-1"><Clock3 className="size-3.5" />计划 {plannedMinutes} 分钟</span>
          <span className="flex items-center gap-1"><Target className="size-3.5" />剩余 {remainingDays} 天</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {tasks.length ? (
          <div className="space-y-1.5">
            {tasks.map(task => (
              <div key={task.id} className="group flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-muted/50">
                <Checkbox className="mt-0.5" checked={task.status === 'done'} onCheckedChange={checked => void onTaskChange(task.id, checked === true)} aria-label={`${task.title}完成状态`} />
                <div className="min-w-0 flex-1">
                  {task.notePath && isTauriRuntime() ? <button type="button" className={cn('flex max-w-full items-center gap-1.5 text-left text-sm font-medium hover:underline', task.status === 'done' && 'text-muted-foreground line-through')} onClick={() => onOpenNote?.(task.notePath!)}><FileText className="size-3.5 shrink-0" /><span className="truncate">{task.title}</span></button> : <p className={cn('text-sm font-medium', task.status === 'done' && 'text-muted-foreground line-through')}>{task.title}</p>}
                  {task.description ? <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{task.description}</p> : null}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{task.plannedMinutes}m</span>
              </div>
            ))}
          </div>
        ) : <div className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">今天没有为这个目标安排任务。</div>}
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button size="sm" onClick={onFocus}><TimerReset />开始专注</Button>
          {tasks.some(task => task.status !== 'done') ? <Button size="sm" variant="outline" disabled={finishing} onClick={() => void finishAll()}><Check />{finishing ? '处理中…' : '完成今日任务'}</Button> : <Badge variant="secondary" className="h-8 px-3 text-emerald-600"><CheckCircle2 />今日已完成</Badge>}
        </div>
      </CardContent>
    </Card>
  )
}

export function TodayView({
  onNavigate,
  onCreateGoal,
  onOpenNote,
}: {
  onNavigate: (value: TodayNavigation) => void
  onCreateGoal: () => void
  onOpenNote?: (path: string) => void
}) {
  const { date, tasks, goals, sessions, settings, addManualTask, setTaskStatus } = useLearningStore()
  const [taskOpen, setTaskOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [minutes, setMinutes] = useState(30)
  const [activeNotePath, setActiveNotePath] = useState('')
  const [linkCurrentNote, setLinkCurrentNote] = useState(true)
  const [events, setEvents] = useState<LearningScheduleEvent[]>([])
  const nativeRuntime = isTauriRuntime()
  const actionable = tasks.filter(task => task.status !== 'cancelled')
  const completed = actionable.filter(task => task.status === 'done').length
  const percent = actionable.length ? Math.round(completed / actionable.length * 100) : 0
  const focusedMinutes = Math.round(sessions.filter(session => session.status === 'completed').reduce((sum, session) => sum + session.effectiveSeconds, 0) / 60)
  const activeGoals = goals.filter(goal => goal.status === 'active' || goal.status === 'planned')
  const manualTasks = actionable.filter(task => !task.goalId)
  const isToday = date === formatLocalDate(Date.now(), settings.timeZone)

  const goalTasks = useMemo(() => new Map(activeGoals.map(goal => [goal.id, actionable.filter(task => task.goalId === goal.id)])), [actionable, activeGoals])

  useEffect(() => {
    void listLearningScheduleEvents(date, date).then(setEvents).catch(() => setEvents([]))
  }, [date])

  useEffect(() => {
    if (!nativeRuntime) return
    let unsubscribe: (() => void) | undefined
    void import('@/stores/article').then(({ default: useArticleStore }) => {
      setActiveNotePath(useArticleStore.getState().activeFilePath)
      unsubscribe = useArticleStore.subscribe(state => setActiveNotePath(state.activeFilePath))
    })
    return () => unsubscribe?.()
  }, [nativeRuntime])

  const handleCreateTask = async () => {
    if (!title.trim()) return
    try {
      await addManualTask({ date, title: title.trim(), description: description.trim(), plannedMinutes: Math.max(5, minutes), notePath: linkCurrentNote ? activeNotePath || null : null })
      setTitle(''); setDescription(''); setTaskOpen(false)
      toast.success('临时任务已添加')
    } catch (error) {
      toast.error('添加任务失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const changeTask = async (id: string, done: boolean) => setTaskStatus(id, done ? 'done' : 'todo')

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{formatChineseDate(date)}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{isToday ? '今天要处理' : '当天学习记录'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">围绕目标完成任务，专注和复盘会自动沉淀到 NoteGen。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => { setLinkCurrentNote(Boolean(activeNotePath)); setTaskOpen(true) }}><Plus />临时任务</Button>
          <Button onClick={() => onNavigate('focus')}><TimerReset />开始专注</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><CheckCircle2 className="size-5" /></div><div><p className="text-2xl font-semibold tabular-nums">{completed}/{actionable.length}</p><p className="text-xs text-muted-foreground">今日任务 · {percent}%</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="grid size-10 place-items-center rounded-lg bg-amber-500/10 text-amber-600"><Flame className="size-5" /></div><div><p className="text-2xl font-semibold tabular-nums">{focusedMinutes}<span className="ml-1 text-sm font-normal">分钟</span></p><p className="text-xs text-muted-foreground">有效专注</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="grid size-10 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600"><Target className="size-5" /></div><div><p className="text-2xl font-semibold tabular-nums">{activeGoals.length}</p><p className="text-xs text-muted-foreground">进行中的目标</p></div></CardContent></Card>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="flex items-center justify-between"><h2 className="text-sm font-medium text-muted-foreground">按目标执行</h2><Button variant="ghost" size="sm" onClick={() => onNavigate('goals')}>目标总览<ArrowRight /></Button></div>
          {activeGoals.length ? activeGoals.map(goal => <GoalTodayCard key={goal.id} goal={goal} tasks={goalTasks.get(goal.id) || []} date={date} onTaskChange={changeTask} onFocus={() => onNavigate('focus')} onOpenNote={onOpenNote} />) : (
            <Card><CardContent className="flex flex-col items-center gap-3 py-12 text-center"><Target className="size-10 text-muted-foreground" /><div><p className="font-medium">还没有进行中的学习目标</p><p className="text-sm text-muted-foreground">创建目标后，NoteGen 会按日期和时间预算生成每日任务。</p></div><Button onClick={onCreateGoal}>创建学习目标</Button></CardContent></Card>
          )}
          {manualTasks.length ? <Card><CardHeader><CardTitle className="text-base">其他任务</CardTitle><CardDescription>临时任务和未关联目标的 NoteGen 笔记。</CardDescription></CardHeader><CardContent className="space-y-2">{manualTasks.map(task => <div key={task.id} className="flex items-center gap-3 rounded-md border p-3"><Checkbox checked={task.status === 'done'} onCheckedChange={checked => void changeTask(task.id, checked === true)} /><span className={cn('min-w-0 flex-1 truncate text-sm', task.status === 'done' && 'text-muted-foreground line-through')}>{task.title}</span><Badge variant="secondary">{task.plannedMinutes}m</Badge></div>)}</CardContent></Card> : null}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle className="text-base">今日日程</CardTitle><CardDescription>{events.length ? `${events.length} 项安排` : '尚未安排'}</CardDescription></div><Button size="icon-sm" variant="ghost" onClick={() => onNavigate('calendar')} aria-label="打开日程"><ArrowRight /></Button></CardHeader>
            <CardContent className="space-y-2">
              {events.length ? events.slice(0, 5).map(event => <button key={event.id} type="button" onClick={() => onNavigate('calendar')} className="flex w-full items-start gap-3 rounded-md border p-2.5 text-left hover:bg-muted/50"><CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{event.title}</span><span className="text-xs text-muted-foreground">{event.allDay ? '全天' : `${event.startTime || '--:--'}${event.endTime ? ` – ${event.endTime}` : ''}`}</span></span></button>) : <button type="button" onClick={() => onNavigate('calendar')} className="w-full rounded-md border border-dashed px-3 py-5 text-center text-sm text-muted-foreground hover:bg-muted/40">添加今天的第一项日程</button>}
            </CardContent>
          </Card>
          <MaimemoProgressCard />
          <Button variant="outline" className="w-full justify-between" onClick={() => onNavigate('reports')}>完成后填写今日复盘<ArrowRight /></Button>
        </aside>
      </div>

      <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>添加临时任务</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label htmlFor="manual-task-title">任务标题</Label><Input id="manual-task-title" value={title} onChange={event => setTitle(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="manual-task-description">说明</Label><Textarea id="manual-task-description" value={description} onChange={event => setDescription(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="manual-task-minutes">预计分钟数</Label><Input id="manual-task-minutes" type="number" min={5} max={720} value={minutes} onChange={event => setMinutes(Number(event.target.value))} /></div>
            {nativeRuntime && activeNotePath ? <label className="flex items-start gap-2 rounded-md border p-3 text-sm"><Checkbox checked={linkCurrentNote} onCheckedChange={checked => setLinkCurrentNote(checked === true)} className="mt-0.5" /><span className="min-w-0"><span className="flex items-center gap-1 font-medium"><Link2 className="size-4" />关联当前 NoteGen 笔记</span><span className="block truncate text-xs text-muted-foreground" title={activeNotePath}>{activeNotePath}</span></span></label> : null}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setTaskOpen(false)}>取消</Button><Button onClick={handleCreateTask} disabled={!title.trim()}>添加</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
