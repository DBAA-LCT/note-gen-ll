'use client'

import { useEffect, useState } from 'react'
import { Flag } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SettingSection, SettingType } from '../components/setting-base'
import { formatLocalDate, isValidTimeZone } from '@/lib/learning/date'
import useLearningStore from '@/stores/learning'
import type { LearningSettings } from '@/types/learning'
import { MaimemoSettingsCard } from '@/features/learning/maimemo-settings-card'

export default function LearningSettingPage() {
  const { initialized, settings, initialize, updateSettings } = useLearningStore()
  const [draft, setDraft] = useState<LearningSettings>(settings)

  useEffect(() => {
    if (!initialized) void initialize(formatLocalDate(Date.now(), settings.timeZone)).catch(() => undefined)
  }, [initialize, initialized, settings.timeZone])

  useEffect(() => setDraft(settings), [settings])

  const save = async () => {
    if (!isValidTimeZone(draft.timeZone)) {
      toast.error('时区无效', { description: '请输入 IANA 时区，例如 Asia/Shanghai。' })
      return
    }
    try {
      await updateSettings({
        ...draft,
        dailyStudyMinutes: Math.max(15, Math.min(720, draft.dailyStudyMinutes || 15)),
        reportDirectory: draft.reportDirectory.trim() || '学习报告/日报',
      })
      toast.success('学习设置已保存')
    } catch (error) {
      toast.error('保存学习设置失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <SettingType id="learning" title="目标" icon={<Flag />} desc="管理目标任务计划、完成规则与日报文件位置。">
      <SettingSection title="学习计划" desc="自动任务会按每日预算和目标权重分配，不会覆盖手工任务。">
        <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="learning-daily-budget">每日学习预算（分钟）</Label><Input id="learning-daily-budget" type="number" min={15} max={720} value={draft.dailyStudyMinutes} onChange={event => setDraft({ ...draft, dailyStudyMinutes: Number(event.target.value) })} /></div>
          <div className="space-y-2"><Label htmlFor="learning-timezone">时区</Label><Input id="learning-timezone" value={draft.timeZone} onChange={event => setDraft({ ...draft, timeZone: event.target.value })} /></div>
        </div>
      </SettingSection>
      <SettingSection title="目标与日报">
        <div className="space-y-4 rounded-lg border p-4">
          <div className="space-y-2"><Label htmlFor="learning-report-directory">日报目录</Label><Input id="learning-report-directory" value={draft.reportDirectory} onChange={event => setDraft({ ...draft, reportDirectory: event.target.value })} /><p className="text-xs text-muted-foreground">日报保存后会作为普通 Markdown 笔记在中央编辑器打开。</p></div>
          <div className="flex items-center justify-between gap-4"><div><Label htmlFor="learning-auto-complete">进度 100% 自动完成目标</Label><p className="text-xs text-muted-foreground">关闭时只更新累计进度。</p></div><Switch id="learning-auto-complete" checked={draft.autoCompleteGoals} onCheckedChange={checked => setDraft({ ...draft, autoCompleteGoals: checked })} /></div>
        </div>
      </SettingSection>
      <div className="flex justify-end"><Button onClick={() => void save()}>保存学习设置</Button></div>
      <SettingSection title="外部学习服务" desc="把其他学习工具的进度汇总到学习中心。">
        <MaimemoSettingsCard />
      </SettingSection>
    </SettingType>
  )
}
