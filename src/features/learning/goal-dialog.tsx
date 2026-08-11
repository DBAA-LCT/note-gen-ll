'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createGoalDraftWithAi } from '@/lib/learning/ai'
import { addLocalDays, formatLocalDate } from '@/lib/learning/date'
import { isTauriRuntime } from '@/lib/check'
import useLearningStore from '@/stores/learning'
import type { CreateLearningGoalInput, LearningGoal } from '@/types/learning'

const DEFAULT_COLOR = '#3b82f6'

function initialForm(goal?: LearningGoal): CreateLearningGoalInput {
  const today = formatLocalDate()
  return goal ? {
    title: goal.title,
    description: goal.description,
    startDate: goal.startDate,
    endDate: goal.endDate,
    timeZone: goal.timeZone,
    weeklyDays: goal.weeklyDays,
    timeWeight: goal.timeWeight,
    color: goal.color,
    note: goal.note,
  } : {
    title: '',
    description: '',
    startDate: today,
    endDate: addLocalDays(today, 30),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    weeklyDays: [1, 2, 3, 4, 5, 6, 0],
    timeWeight: 5,
    color: DEFAULT_COLOR,
    note: '',
  }
}

export function GoalDialog({
  open,
  onOpenChange,
  goal,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  goal?: LearningGoal
}) {
  const { goals, settings, saveGoal } = useLearningStore()
  const [form, setForm] = useState<CreateLearningGoalInput>(() => initialForm(goal))
  const [saving, setSaving] = useState(false)
  const [aiRequest, setAiRequest] = useState('')
  const [generating, setGenerating] = useState(false)
  const nativeRuntime = isTauriRuntime()

  useEffect(() => {
    if (open) setForm(initialForm(goal))
  }, [goal, open])

  const setField = <K extends keyof CreateLearningGoalInput>(field: K, value: CreateLearningGoalInput[K]) => {
    setForm(current => ({ ...current, [field]: value }))
  }

  const handleAiDraft = async () => {
    if (!aiRequest.trim()) {
      toast.error('请先描述你想完成的学习目标')
      return
    }
    setGenerating(true)
    try {
      const draft = await createGoalDraftWithAi(aiRequest.trim(), {
        date: formatLocalDate(),
        dailyMinutes: settings.dailyStudyMinutes,
        activeGoals: goals.filter(item => item.status === 'active' || item.status === 'planned'),
      })
      setForm(current => ({ ...current, ...draft }))
      toast.success('AI 草稿已填入表单，请确认后保存')
    } catch (error) {
      toast.error('AI 规划失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setGenerating(false)
    }
  }

  const handleSave = async () => {
    if (!form.title.trim() || !form.description.trim()) {
      toast.error('请填写目标标题和具体目标')
      return
    }
    if (form.endDate < form.startDate) {
      toast.error('结束日期不能早于开始日期')
      return
    }
    setSaving(true)
    try {
      await saveGoal({
        ...form,
        title: form.title.trim(),
        description: form.description.trim(),
        note: form.note.trim(),
        timeWeight: Math.max(1, Math.min(10, Math.round(form.timeWeight))),
      }, goal?.id)
      toast.success(goal ? '目标已更新' : '目标已创建，今日任务已准备')
      onOpenChange(false)
    } catch (error) {
      toast.error('保存目标失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{goal ? '编辑学习目标' : '新建学习目标'}</DialogTitle>
          <DialogDescription>任务会根据时间范围、权重和每日预算自动生成。</DialogDescription>
        </DialogHeader>

        {!goal && nativeRuntime && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <Label htmlFor="goal-ai-request">让 AI 帮我规划</Label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Textarea
                id="goal-ai-request"
                value={aiRequest}
                onChange={event => setAiRequest(event.target.value)}
                placeholder="例如：三个月内学完线性代数，每天约一小时，希望能解决基础习题"
                rows={2}
              />
              <Button className="w-full sm:w-auto" variant="secondary" onClick={handleAiDraft} disabled={generating}>
                <Sparkles data-icon="inline-start" />{generating ? '规划中' : '生成草稿'}
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="goal-title">标题</Label>
            <Input id="goal-title" value={form.title} onChange={event => setField('title', event.target.value)} placeholder="例如：线性代数" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="goal-description">具体目标</Label>
            <Textarea id="goal-description" value={form.description} onChange={event => setField('description', event.target.value)} placeholder="描述最终要达到的、可验收的结果" rows={3} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal-start">开始日期</Label>
            <Input id="goal-start" type="date" value={form.startDate} onChange={event => setField('startDate', event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal-end">结束日期</Label>
            <Input id="goal-end" type="date" value={form.endDate} onChange={event => setField('endDate', event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal-weight">时间权重（1—10）</Label>
            <Input id="goal-weight" type="number" min={1} max={10} value={form.timeWeight} onChange={event => setField('timeWeight', Number(event.target.value))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal-color">目标颜色</Label>
            <div className="flex gap-2">
              <Input id="goal-color" type="color" className="w-14 px-1" value={form.color} onChange={event => setField('color', event.target.value)} />
              <Input value={form.color} onChange={event => setField('color', event.target.value)} aria-label="颜色值" />
            </div>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="goal-note">备注与执行建议</Label>
            <Textarea id="goal-note" value={form.note} onChange={event => setField('note', event.target.value)} rows={4} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? '保存中…' : '保存目标'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
