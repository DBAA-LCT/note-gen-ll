'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/responsive-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { addLocalDays, formatLocalDate } from '@/lib/learning/date'
import useLearningStore from '@/stores/learning'
import type { CreateLearningGoalInput, LearningGoal } from '@/types/learning'

const DEFAULT_COLOR = '#3b82f6'

function initialForm(goal?: LearningGoal, draft?: Partial<CreateLearningGoalInput>): CreateLearningGoalInput {
  const today = formatLocalDate()
  const base = goal ? {
    title: goal.title,
    description: goal.description,
    startDate: goal.startDate,
    endDate: goal.endDate,
    timeZone: goal.timeZone,
    weeklyDays: goal.weeklyDays,
    timeWeight: goal.timeWeight,
    color: goal.color,
    note: goal.note,
    planMarkdown: goal.planMarkdown,
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
    planMarkdown: '',
  }
  return { ...base, ...draft }
}

export function GoalDialog({
  open,
  onOpenChange,
  goal,
  draft,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  goal?: LearningGoal
  draft?: Partial<CreateLearningGoalInput>
}) {
  const { saveGoal } = useLearningStore()
  const [form, setForm] = useState<CreateLearningGoalInput>(() => initialForm(goal, draft))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setForm(initialForm(goal, draft))
  }, [draft, goal, open])

  const setField = <K extends keyof CreateLearningGoalInput>(field: K, value: CreateLearningGoalInput[K]) => {
    setForm(current => ({ ...current, [field]: value }))
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
      toast.success(goal ? '目标已更新' : '目标已创建，可以安排第一天的任务了')
      onOpenChange(false)
    } catch (error) {
      toast.error('保存目标失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{goal ? '编辑目标' : '新建目标'}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>目标用于组织总体路线、相关笔记和每天要做的事情。</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

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
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="goal-weight">时间权重（1—10）</Label>
            <Input id="goal-weight" type="number" min={1} max={10} value={form.timeWeight} onChange={event => setField('timeWeight', Number(event.target.value))} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="goal-note">备注与执行建议</Label>
            <Textarea id="goal-note" value={form.note} onChange={event => setField('note', event.target.value)} rows={4} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="goal-plan">总体规划（可选）</Label>
            <Textarea
              id="goal-plan"
              value={form.planMarkdown}
              onChange={event => setField('planMarkdown', event.target.value)}
              placeholder="写下阶段、里程碑和进入下一阶段的标准"
              rows={6}
            />
          </div>
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? '保存中…' : '保存目标'}</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
