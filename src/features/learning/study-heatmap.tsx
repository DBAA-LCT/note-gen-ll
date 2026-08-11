'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { addLocalDays, formatLocalDate } from '@/lib/learning/date'
import { listLearningDaySummaries } from '@/lib/learning/repository'
import { cn } from '@/lib/utils'
import useLearningStore from '@/stores/learning'
import type { LearningDaySummary } from '@/types/learning'

function monthKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` }
function tone(minutes: number) { return minutes >= 120 ? 'bg-primary' : minutes >= 60 ? 'bg-primary/70' : minutes > 0 ? 'bg-primary/30' : 'bg-muted' }

export function StudyHeatmap() {
  const { settings, loadDate } = useLearningStore()
  const today = formatLocalDate(Date.now(), settings.timeZone)
  const [month, setMonth] = useState(() => new Date())
  const [summaries, setSummaries] = useState<LearningDaySummary[]>([])
  const key = monthKey(month)
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const start = `${key}-01`
  const end = `${key}-${String(lastDay).padStart(2, '0')}`

  useEffect(() => { void listLearningDaySummaries(start, end).then(setSummaries) }, [end, start])
  const byDate = useMemo(() => new Map(summaries.map(item => [item.localDate, item])), [summaries])
  const leading = (new Date(`${start}T12:00:00`).getDay() + 6) % 7
  const cells = [...Array.from({ length: leading }, () => ''), ...Array.from({ length: lastDay }, (_, index) => addLocalDays(start, index))]
  const totalMinutes = summaries.reduce((sum, item) => sum + item.focusedMinutes, 0)
  const activeDays = summaries.filter(item => item.focusedMinutes || item.taskDone || item.hasReport).length

  return <Card><CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle className="text-base">学习热力图</CardTitle><CardDescription>{activeDays} 个学习日 · 专注 {totalMinutes} 分钟</CardDescription></div><div className="flex items-center gap-1"><Button size="icon-sm" variant="ghost" onClick={() => setMonth(value => new Date(value.getFullYear(), value.getMonth() - 1, 1))}><ChevronLeft /></Button><span className="min-w-24 text-center text-sm">{month.getFullYear()}年{month.getMonth() + 1}月</span><Button size="icon-sm" variant="ghost" onClick={() => setMonth(value => new Date(value.getFullYear(), value.getMonth() + 1, 1))}><ChevronRight /></Button></div></CardHeader><CardContent><div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">{['一','二','三','四','五','六','日'].map(day => <span key={day}>{day}</span>)}</div><div className="grid grid-cols-7 gap-1">{cells.map((cell, index) => cell ? <button key={cell} type="button" title={`${cell} · ${byDate.get(cell)?.focusedMinutes || 0} 分钟`} onClick={() => void loadDate(cell, { ensureTasks: cell <= today })} className={cn('aspect-square rounded-sm text-[10px] transition-transform hover:scale-110', tone(byDate.get(cell)?.focusedMinutes || 0), cell === today && 'ring-1 ring-foreground')}><span className="opacity-70">{Number(cell.slice(-2))}</span></button> : <span key={`empty-${index}`} />)}</div></CardContent></Card>
}
