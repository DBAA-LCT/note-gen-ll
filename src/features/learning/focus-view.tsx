'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CirclePause, CirclePlay, ListChecks, RotateCcw, Square } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import useLearningStore from '@/stores/learning'
import type { FocusSession } from '@/types/learning'

const STORAGE_KEY = 'notegen.learning.active-focus.v1'

interface ActiveTimer {
  id: string
  taskId: string | null
  taskIds: string[]
  goalId: string | null
  localDate: string
  startedAt: number
  runningSince: number | null
  accumulatedSeconds: number
}

function uuid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function elapsedSeconds(timer: ActiveTimer | null, now: number) {
  if (!timer) return 0
  return timer.accumulatedSeconds + (timer.runningSince ? Math.max(0, Math.floor((now - timer.runningSince) / 1000)) : 0)
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return [hours, minutes, rest].map(value => String(value).padStart(2, '0')).join(':')
}

export function FocusView({ onBack }: { onBack?: () => void }) {
  const { date, tasks, sessions, saveSession, setTaskStatus } = useLearningStore()
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [timer, setTimer] = useState<ActiveTimer | null>(null)
  const [now, setNow] = useState(Date.now())
  const actionableTasks = tasks.filter(task => task.status !== 'done' && task.status !== 'cancelled')

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const restored = JSON.parse(raw) as ActiveTimer
      if (restored.localDate === date) {
        const taskIds = restored.taskIds?.length ? restored.taskIds : restored.taskId ? [restored.taskId] : []
        setTimer({ ...restored, taskIds })
        setSelectedTaskIds(taskIds)
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [date])

  useEffect(() => {
    if (timer) localStorage.setItem(STORAGE_KEY, JSON.stringify(timer))
    else localStorage.removeItem(STORAGE_KEY)
  }, [timer])

  useEffect(() => {
    if (!timer?.runningSince) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [timer?.runningSince])

  const elapsed = elapsedSeconds(timer, now)
  const todaySeconds = useMemo(
    () => sessions.filter(session => session.status === 'completed').reduce((sum, session) => sum + session.effectiveSeconds, 0),
    [sessions],
  )
  const completedSessions = useMemo(
    () => sessions.filter(session => session.status === 'completed'),
    [sessions],
  )

  const toggleTask = (taskId: string, checked: boolean) => {
    setSelectedTaskIds(current => checked
      ? [...current, taskId]
      : current.filter(id => id !== taskId))
  }

  const start = async () => {
    const selected = tasks.filter(task => selectedTaskIds.includes(task.id))
    const primaryTask = selected[0]
    const timestamp = Date.now()
    const next: ActiveTimer = {
      id: uuid(),
      taskId: primaryTask?.id || null,
      taskIds: selected.map(task => task.id),
      goalId: primaryTask?.goalId || null,
      localDate: date,
      startedAt: timestamp,
      runningSince: timestamp,
      accumulatedSeconds: 0,
    }
    setTimer(next)
    setNow(timestamp)
    for (const task of selected) {
      if (task.status === 'todo') await setTaskStatus(task.id, 'in-progress')
    }
  }

  const pause = () => {
    if (!timer?.runningSince) return
    const timestamp = Date.now()
    setTimer({ ...timer, accumulatedSeconds: elapsedSeconds(timer, timestamp), runningSince: null })
    setNow(timestamp)
  }

  const resume = () => {
    if (!timer || timer.runningSince) return
    const timestamp = Date.now()
    setTimer({ ...timer, runningSince: timestamp })
    setNow(timestamp)
  }

  const finish = async (status: FocusSession['status'] = 'completed') => {
    if (!timer) return
    const timestamp = Date.now()
    const effectiveSeconds = elapsedSeconds(timer, timestamp)
    try {
      if (effectiveSeconds > 0) {
        await saveSession({
          id: timer.id,
          taskId: timer.taskId,
          taskIds: timer.taskIds,
          goalId: timer.goalId,
          localDate: timer.localDate,
          startedAt: timer.startedAt,
          endedAt: timestamp,
          effectiveSeconds,
          status,
          createdAt: timer.startedAt,
          updatedAt: timestamp,
        })
      }
      setTimer(null)
      setNow(timestamp)
      toast.success(status === 'completed' ? '专注记录已保存' : '本次计时已放弃')
    } catch (error) {
      toast.error('保存专注记录失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 md:p-6">
      <div className="flex items-start gap-3">
        {onBack ? <Button size="icon-sm" variant="ghost" onClick={onBack} aria-label="返回今日"><ArrowLeft /></Button> : null}
        <div><h1 className="text-2xl font-semibold tracking-tight">专注计时</h1><p className="text-sm text-muted-foreground">计时状态保存在本机，返回目标页后仍可继续。</p></div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card>
          <CardHeader><CardTitle>当前专注</CardTitle><CardDescription>暂停时间不会计入有效投入时长。</CardDescription></CardHeader>
          <CardContent className="flex flex-col items-center gap-6 py-8">
            <div className="font-mono text-5xl font-semibold tabular-nums sm:text-7xl">{formatDuration(elapsed)}</div>
            <div className="w-full max-w-md space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label>关联任务</Label>
                <span className="text-xs text-muted-foreground">{selectedTaskIds.length ? `已选 ${selectedTaskIds.length} 项` : '自由专注'}</span>
              </div>
              <div className="overflow-hidden rounded-xl border bg-muted/15">
                <label className="flex cursor-pointer items-center gap-3 border-b px-3 py-3 transition-colors hover:bg-muted/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                  <Checkbox
                    checked={selectedTaskIds.length === 0}
                    disabled={Boolean(timer)}
                    onCheckedChange={() => setSelectedTaskIds([])}
                    aria-label="自由专注，不关联任务"
                  />
                  <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium"><ListChecks className="size-4 text-muted-foreground" />自由专注（不关联任务）</span>
                </label>
                <ScrollArea className="h-52">
                  <div className="divide-y">
                    {actionableTasks.map(task => {
                      const checked = selectedTaskIds.includes(task.id)
                      return (
                        <label key={task.id} className="flex cursor-pointer items-start gap-3 px-3 py-3 transition-colors hover:bg-muted/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                          <Checkbox
                            className="mt-0.5"
                            checked={checked}
                            disabled={Boolean(timer)}
                            onCheckedChange={value => toggleTask(task.id, value === true)}
                            aria-label={`关联任务：${task.title}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{task.title}</span>
                            {task.goalTitle ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{task.goalTitle}</span> : null}
                          </span>
                        </label>
                      )
                    })}
                    {!actionableTasks.length ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">今天没有可关联的任务</p> : null}
                  </div>
                </ScrollArea>
              </div>
              <p className="text-xs text-muted-foreground">可同时选择多个任务；计时开始后将锁定本次关联。</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {!timer && <Button size="lg" onClick={() => void start()}><CirclePlay data-icon="inline-start" />开始</Button>}
              {timer?.runningSince && <Button size="lg" variant="outline" onClick={pause}><CirclePause data-icon="inline-start" />暂停</Button>}
              {timer && !timer.runningSince && <Button size="lg" onClick={resume}><CirclePlay data-icon="inline-start" />继续</Button>}
              {timer && <Button size="lg" variant="outline" onClick={() => void finish('completed')}><Square data-icon="inline-start" />结束并保存</Button>}
              {timer && <Button size="lg" variant="ghost" onClick={() => void finish('cancelled')}><RotateCcw data-icon="inline-start" />放弃</Button>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>今日统计</CardTitle><CardDescription>仅统计已经结束并保存的记录。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div><p className="text-3xl font-semibold">{Math.round(todaySeconds / 60)} 分钟</p><p className="text-xs text-muted-foreground">累计有效专注</p></div>
            <div className="space-y-2">{completedSessions.length ? completedSessions.slice().reverse().map(session => {
              const taskIds = session.taskIds?.length ? session.taskIds : session.taskId ? [session.taskId] : []
              const taskTitles = taskIds.map(id => tasks.find(item => item.id === id)?.title).filter(Boolean)
              const title = taskTitles.length ? taskTitles.join('、') : '自由专注'
              return <div key={session.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm"><span className="truncate" title={title}>{title}</span><Badge variant="secondary">{Math.round(session.effectiveSeconds / 60)} 分钟</Badge></div>
            }) : <p className="text-sm text-muted-foreground">今天还没有专注记录。</p>}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
