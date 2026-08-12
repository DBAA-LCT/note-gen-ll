'use client'

import { useEffect, useMemo, useState } from 'react'
import { BookOpenCheck, Clock3, FileText, Flag, History, Link2, Plus, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { openLearningWorkspace } from '@/features/learning/open-learning-workspace'
import { formatLocalDate } from '@/lib/learning/date'
import useArticleStore from '@/stores/article'
import useLearningStore from '@/stores/learning'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import useLearningWorkspaceStore from '@/stores/learning-workspace'

function compactDate(date: string) {
  const value = new Date(`${date}T12:00:00`)
  if (Number.isNaN(value.getTime())) return '读取日期中…'
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(value)
}

const planningActions = [
  { view: 'today' as const, label: '今日', icon: BookOpenCheck },
  { view: 'goals' as const, label: '目标', icon: Flag },
  { view: 'reports' as const, label: '回顾', icon: History },
]

export function PlanningActions() {
  const openSettings = useSettingsDialogStore((state) => state.openSettings)
  return (
    <div className="flex items-center gap-0.5">
      {planningActions.map(({ view, label, icon: Icon }) => (
        <Button key={view} size="icon-sm" variant="ghost" title={label} aria-label={label} onClick={() => void openLearningWorkspace(view)}>
          <Icon />
        </Button>
      ))}
      <Button size="icon-sm" variant="ghost" title="规划设置" aria-label="规划设置" onClick={() => openSettings('learning')}><Settings2 /></Button>
    </div>
  )
}

export function LearningSidebar() {
  const { initialized, loading, error, date, tasks, sessions, settings, initialize, addManualTask, setTaskStatus } = useLearningStore()
  const activeFilePath = useArticleStore((state) => state.activeFilePath)
  const requestCreateGoal = useLearningWorkspaceStore((state) => state.requestCreateGoal)
  const [taskOpen, setTaskOpen] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskMinutes, setTaskMinutes] = useState(0)
  const [linkCurrentNote, setLinkCurrentNote] = useState(true)

  useEffect(() => {
    if (initialized && date) return
    void initialize(formatLocalDate(Date.now(), settings.timeZone)).catch(() => undefined)
  }, [date, initialize, initialized, settings.timeZone])

  const actionableTasks = tasks.filter((task) => task.status !== 'cancelled')
  const completedTasks = actionableTasks.filter((task) => task.status === 'done').length
  const completionPercent = actionableTasks.length ? Math.round(actionableTasks.reduce((sum, task) => sum + task.progressPercent, 0) / actionableTasks.length) : 0
  const focusMinutes = useMemo(
    () => Math.round(sessions.filter((session) => session.status === 'completed').reduce((sum, session) => sum + session.effectiveSeconds, 0) / 60),
    [sessions],
  )

  const openTaskDialog = (fromCurrentNote = false) => {
    if (fromCurrentNote && activeFilePath) {
      setTaskTitle(activeFilePath.split(/[\\/]/).pop()?.replace(/\.(md|markdown)$/i, '') || '')
      setTaskDescription(`关联笔记：${activeFilePath}`)
      setLinkCurrentNote(true)
    } else {
      setLinkCurrentNote(Boolean(activeFilePath))
    }
    setTaskOpen(true)
  }

  const startGoalCreation = async () => {
    await openLearningWorkspace('goals')
    requestCreateGoal()
  }

  const createManualTask = async () => {
    if (!taskTitle.trim()) return
    try {
      await addManualTask({
        date,
        title: taskTitle.trim(),
        description: taskDescription.trim(),
        plannedMinutes: Math.max(0, taskMinutes || 0),
        notePath: linkCurrentNote ? activeFilePath || null : null,
      })
      setTaskTitle('')
      setTaskDescription('')
      setTaskOpen(false)
      toast.success('任务已添加')
    } catch (taskError) {
      toast.error('添加任务失败', { description: taskError instanceof Error ? taskError.message : String(taskError) })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error ? <div className="mb-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div> : null}

        <section className="border-b py-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">今日 · {date ? compactDate(date) : '读取日期中…'}</span>
            <span className="tabular-nums">{completedTasks}/{actionableTasks.length} · {completionPercent}%</span>
          </div>
          <Progress value={completionPercent} className="h-1" />
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Clock3 className="size-3.5" />专注 {focusMinutes} 分钟</span>
            <button type="button" className="hover:text-foreground" onClick={() => void openLearningWorkspace('focus')}>开始执行</button>
          </div>
        </section>

        <section className="py-3">
          <div className="mb-1 flex h-7 items-center justify-between px-1">
            <h3 className="text-xs font-medium text-muted-foreground">今日任务</h3>
            <div className="flex items-center gap-0.5">
              {activeFilePath ? <Button size="icon-xs" variant="ghost" title="把当前笔记加入今日任务" onClick={() => openTaskDialog(true)}><Link2 /></Button> : null}
              <Button size="icon-xs" variant="ghost" title="添加任务" onClick={() => openTaskDialog()}><Plus /></Button>
            </div>
          </div>

          {loading && !actionableTasks.length ? <p className="px-2 py-3 text-xs text-muted-foreground">正在生成今日计划…</p> : null}
          {!loading && !actionableTasks.length ? (
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-3 text-left text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground" onClick={() => void startGoalCreation()}>
              <Plus className="size-3.5" />先创建一个目标
            </button>
          ) : null}
          {actionableTasks.slice(0, 6).map((task) => (
            <div key={task.id} className="group flex min-h-10 items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/60">
              <Checkbox className="mt-0.5" checked={task.status === 'done'} onCheckedChange={(checked) => void setTaskStatus(task.id, checked === true ? 'done' : 'todo')} />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void openLearningWorkspace('today')}>
                <span className={task.status === 'done' ? 'flex items-center gap-1 truncate text-sm text-muted-foreground line-through' : 'flex items-center gap-1 truncate text-sm'}>
                  {task.notePath ? <FileText className="size-3.5 shrink-0" /> : null}{task.title}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">{task.goalTitle ? `${task.goalTitle} · ` : ''}进度 {Math.round(task.progressPercent)}%</span>
                <Progress value={task.progressPercent} className="mt-1 h-0.5" />
              </button>
            </div>
          ))}
          {actionableTasks.length > 6 ? (
            <button type="button" className="w-full px-2 py-2 text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => void openLearningWorkspace('today')}>查看全部 {actionableTasks.length} 项</button>
          ) : null}
        </section>
      </div>

      <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>添加今日任务</DialogTitle><DialogDescription>任务会加入今天的计划，也可以关联当前 NoteGen 笔记。</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label htmlFor="learning-task-title">任务标题</Label><Input id="learning-task-title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="learning-task-description">说明</Label><Textarea id="learning-task-description" value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="learning-task-minutes">预计时间（分钟，可选）</Label><Input id="learning-task-minutes" type="number" min={0} max={720} value={taskMinutes} onChange={(event) => setTaskMinutes(Number(event.target.value))} /></div>
            {activeFilePath ? (
              <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <Checkbox checked={linkCurrentNote} onCheckedChange={(checked) => setLinkCurrentNote(checked === true)} className="mt-0.5" />
                <span className="min-w-0"><span className="block font-medium">关联当前笔记</span><span className="block truncate text-xs text-muted-foreground" title={activeFilePath}>{activeFilePath}</span></span>
              </label>
            ) : null}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setTaskOpen(false)}>取消</Button><Button disabled={!taskTitle.trim()} onClick={() => void createManualTask()}>添加</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
