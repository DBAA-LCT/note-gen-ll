'use client'

import { useEffect, useState } from 'react'
import { BookOpenText, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { getMaimemoStudyProgress, getMaimemoTodayItems, getMaimemoToken, type MaimemoStudyProgress, type MaimemoTodayItem } from '@/lib/learning/maimemo'

export function MaimemoProgressCard() {
  const [progress, setProgress] = useState<MaimemoStudyProgress | null>(null)
  const [items, setItems] = useState<MaimemoTodayItem[]>([])
  const [configured, setConfigured] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const refresh = async () => {
    setLoading(true); setError('')
    try {
      const token = await getMaimemoToken()
      setConfigured(Boolean(token))
      if (token) {
        const [nextProgress, nextItems] = await Promise.all([
          getMaimemoStudyProgress(token),
          getMaimemoTodayItems({ limit: 12 }),
        ])
        setProgress(nextProgress)
        setItems(nextItems)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [])
  const percent = progress?.total ? Math.round(progress.finished / progress.total * 100) : 0
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div><CardTitle className="flex items-center gap-2 text-base"><BookOpenText className="size-4" />墨墨今日学习</CardTitle><CardDescription>{configured ? '来自墨墨开放 API 的实时进度' : '在学习设置中配置个人 Token 后显示进度'}</CardDescription></div>
        {configured ? <Button size="icon-sm" variant="ghost" disabled={loading} onClick={() => void refresh()} aria-label="刷新墨墨进度"><RefreshCw className={loading ? 'animate-spin' : ''} /></Button> : null}
      </CardHeader>
      {progress ? <CardContent className="space-y-3">
        <div className="flex items-end justify-between"><span className="text-2xl font-semibold">{progress.finished} / {progress.total}</span><span className="text-sm text-muted-foreground">{Math.round(progress.study_time / 60000)} 分钟</span></div>
        <Progress value={percent} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>完成 {percent}%</span><span>新词 {items.filter(item => item.is_new).length}</span><span>待完成 {items.filter(item => !item.is_finished).length}</span></div>
        {items.length ? <div className="flex flex-wrap gap-1.5">{items.slice(0, 8).map(item => <span key={item.voc_id} className={item.is_finished ? 'rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground line-through' : 'rounded-md bg-muted px-2 py-1 text-xs'}>{item.voc_spelling}</span>)}</div> : null}
      </CardContent> : error ? <CardContent className="text-sm text-destructive">{error}</CardContent> : null}
    </Card>
  )
}
