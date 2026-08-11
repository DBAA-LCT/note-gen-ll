'use client'

import { useEffect, useState } from 'react'
import { BookOpenCheck, CheckCircle2, Clock3, FileText, Link2, Plus, TimerReset } from 'lucide-react'
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
import { isTauriRuntime } from '@/lib/check'
import useLearningStore from '@/stores/learning'
import { MaimemoProgressCard } from './maimemo-progress-card'
import { StudyHeatmap } from './study-heatmap'

export function TodayView({
  onNavigate,
  onCreateGoal,
  onOpenNote,
}: {
  onNavigate: (value: 'focus' | 'reports') => void
  onCreateGoal: () => void
  onOpenNote?: (path: string) => void
}) {
  const { date, tasks, goals, settings, addManualTask, setTaskStatus } = useLearningStore()
  const [taskOpen, setTaskOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [minutes, setMinutes] = useState(30)
  const [activeNotePath, setActiveNotePath] = useState('')
  const [linkCurrentNote, setLinkCurrentNote] = useState(true)
  const nativeRuntime = isTauriRuntime()
  const completed = tasks.filter(task => task.status === 'done').length
  const actionable = tasks.filter(task => task.status !== 'cancelled')
  const percent = actionable.length ? Math.round(completed / actionable.length * 100) : 0
  const plannedMinutes = actionable.reduce((sum, task) => sum + task.plannedMinutes, 0)
  const isToday = date === formatLocalDate(Date.now(), settings.timeZone)

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
      setTitle('')
      setDescription('')
      setTaskOpen(false)
      toast.success('临时任务已添加')
    } catch (error) {
      toast.error('添加任务失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{formatChineseDate(date)}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{isToday ? '今天的学习' : '历史学习记录'}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setLinkCurrentNote(Boolean(activeNotePath)); setTaskOpen(true) }}><Plus data-icon="inline-start" />临时任务</Button>
          <Button onClick={() => onNavigate('focus')}><TimerReset data-icon="inline-start" />开始专注</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardDescription>任务进度</CardDescription><CardTitle>{completed} / {actionable.length}</CardTitle></CardHeader><CardContent><Progress value={percent} /><p className="mt-2 text-xs text-muted-foreground">完成率 {percent}%</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardDescription>预计投入</CardDescription><CardTitle>{plannedMinutes} 分钟</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground"><Clock3 className="mr-1 inline size-4" />按目标权重自动分配</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardDescription>活动目标</CardDescription><CardTitle>{goals.filter(goal => goal.status === 'active' || goal.status === 'planned').length} 个</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground"><BookOpenCheck className="mr-1 inline size-4" />长期进度会随日报更新</CardContent></Card>
      </div>

      <MaimemoProgressCard />

      <StudyHeatmap />

      <Card>
        <CardHeader>
          <CardTitle>今日任务</CardTitle>
          <CardDescription>自动任务不会覆盖你手工添加或修改的内容。</CardDescription>
        </CardHeader>
        <CardContent>
          {actionable.length ? (
            <div className="space-y-3">
              {actionable.map(task => (
                <div key={task.id} className="flex gap-3 rounded-lg border p-3">
                  <Checkbox
                    className="mt-1"
                    checked={task.status === 'done'}
                    onCheckedChange={checked => void setTaskStatus(task.id, checked ? 'done' : 'todo')}
                    aria-label={`${task.title}完成状态`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {task.notePath && nativeRuntime ? <button type="button" className={task.status === 'done' ? 'flex items-center gap-1 font-medium text-muted-foreground line-through' : 'flex items-center gap-1 font-medium hover:underline'} title={task.notePath} onClick={() => onOpenNote?.(task.notePath!)}><FileText className="size-4" />{task.title}</button> : <p className={task.status === 'done' ? 'font-medium line-through text-muted-foreground' : 'font-medium'}>{task.title}</p>}
                      {task.goalTitle && <Badge variant="outline" style={{ borderColor: task.goalColor }}>{task.goalTitle}</Badge>}
                      <Badge variant="secondary">{task.plannedMinutes} 分钟</Badge>
                      {task.source === 'manual' && <Badge variant="outline">手工</Badge>}
                    </div>
                    {task.description && <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>}
                    {task.completionCriteria && <p className="mt-2 text-xs text-muted-foreground">完成标准：{task.completionCriteria}</p>}
                  </div>
                </div>
              ))}
              {percent === 100 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <div className="flex items-center gap-2"><CheckCircle2 className="size-5 text-emerald-600" /><span>今天的任务已经全部完成。</span></div>
                  <Button variant="outline" onClick={() => onNavigate('reports')}>填写今日日报</Button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <BookOpenCheck className="size-10 text-muted-foreground" />
              <div><p className="font-medium">今天还没有任务</p><p className="text-sm text-muted-foreground">创建目标后会自动生成，也可以添加临时任务。</p></div>
              <div className="flex gap-2"><Button onClick={onCreateGoal}>创建学习目标</Button><Button variant="outline" onClick={() => onNavigate('focus')}>自由专注</Button></div>
            </div>
          )}
        </CardContent>
      </Card>

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
