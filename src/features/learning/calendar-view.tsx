'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarCheck2, ChevronLeft, ChevronRight, Clock3, FileText, Flag, List, ListChecks, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { addLocalDays, formatChineseDate, formatLocalDate } from '@/lib/learning/date'
import { deleteLearningScheduleEvent, listLearningDaySummaries, listLearningScheduleEvents, saveLearningScheduleEvent } from '@/lib/learning/repository'
import { cn } from '@/lib/utils'
import useLearningStore from '@/stores/learning'
import type { LearningDaySummary, LearningScheduleEvent, SaveLearningScheduleEventInput } from '@/types/learning'

type CalendarView = 'day' | 'week' | 'month' | 'year' | 'agenda'
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const viewLabel: Record<CalendarView, string> = { day: '日', week: '周', month: '月', year: '年', agenda: '议程' }
const toDate = (value: string) => new Date(`${value}T12:00:00`)
const dateKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
const monthKey = (value: Date) => dateKey(value).slice(0, 7)
const startOfWeek = (value: string) => addLocalDays(value, -((toDate(value).getDay() + 6) % 7))

function rangeFor(view: CalendarView, cursor: Date) {
  const current = dateKey(cursor)
  if (view === 'day') return { start: current, end: current }
  if (view === 'week') { const start = startOfWeek(current); return { start, end: addLocalDays(start, 6) } }
  if (view === 'year') return { start: `${cursor.getFullYear()}-01-01`, end: `${cursor.getFullYear()}-12-31` }
  if (view === 'agenda') return { start: current, end: addLocalDays(current, 60) }
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
  return { start: `${monthKey(cursor)}-01`, end: `${monthKey(cursor)}-${String(last).padStart(2, '0')}` }
}

function monthCells(cursor: Date) {
  const first = `${monthKey(cursor)}-01`
  const leading = (toDate(first).getDay() + 6) % 7
  const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
  return [...Array.from({ length: leading }, () => ''), ...Array.from({ length: days }, (_, index) => addLocalDays(first, index))]
}

const emptyEvent = (localDate: string): SaveLearningScheduleEventInput => ({ title: '', localDate, startTime: '09:00', endTime: '10:00', allDay: false, kind: 'schedule', notes: '' })

export function LearningCalendarView({ onNavigate }: { onNavigate: (tab: 'today' | 'reports') => void }) {
  const { date, tasks, sessions, report, settings, loadDate } = useLearningStore()
  const today = formatLocalDate(Date.now(), settings.timeZone)
  const [view, setView] = useState<CalendarView>('month')
  const [cursor, setCursor] = useState(() => toDate(date || today))
  const [summaries, setSummaries] = useState<LearningDaySummary[]>([])
  const [events, setEvents] = useState<LearningScheduleEvent[]>([])
  const [query, setQuery] = useState('')
  const [eventOpen, setEventOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<LearningScheduleEvent | null>(null)
  const [draft, setDraft] = useState<SaveLearningScheduleEventInput>(() => emptyEvent(date || today))
  const range = useMemo(() => rangeFor(view, cursor), [cursor, view])

  const reload = useCallback(async () => {
    const [nextSummaries, nextEvents] = await Promise.all([listLearningDaySummaries(range.start, range.end), listLearningScheduleEvents(range.start, range.end)])
    setSummaries(nextSummaries); setEvents(nextEvents)
  }, [range.end, range.start])
  useEffect(() => { void reload() }, [reload, report, sessions, tasks])

  const summaryMap = useMemo(() => new Map(summaries.map(item => [item.localDate, item])), [summaries])
  const eventMap = useMemo(() => {
    const map = new Map<string, LearningScheduleEvent[]>()
    events.filter(item => !query || `${item.title} ${item.notes}`.toLowerCase().includes(query.toLowerCase())).forEach(item => map.set(item.localDate, [...(map.get(item.localDate) || []), item]))
    return map
  }, [events, query])
  const selectedEvents = eventMap.get(date) || []
  const selectedSummary = summaryMap.get(date)

  const selectDate = async (nextDate: string) => {
    setCursor(toDate(nextDate))
    await loadDate(nextDate, { ensureTasks: nextDate <= today })
  }
  const move = (direction: number) => setCursor(value => {
    const next = new Date(value)
    if (view === 'day') next.setDate(next.getDate() + direction)
    else if (view === 'week') next.setDate(next.getDate() + direction * 7)
    else if (view === 'year') next.setFullYear(next.getFullYear() + direction)
    else if (view === 'agenda') next.setDate(next.getDate() + direction * 30)
    else next.setMonth(next.getMonth() + direction)
    return next
  })
  const openCreate = (localDate = date || today) => { setEditingEvent(null); setDraft(emptyEvent(localDate)); setEventOpen(true) }
  const openEdit = (event: LearningScheduleEvent) => { setEditingEvent(event); setDraft({ title: event.title, localDate: event.localDate, startTime: event.startTime, endTime: event.endTime, allDay: event.allDay, kind: event.kind, notes: event.notes }); setEventOpen(true) }
  const saveEvent = async () => {
    if (!draft.title.trim()) return
    if (!draft.allDay && draft.startTime && draft.endTime && draft.endTime <= draft.startTime) { toast.error('结束时间需要晚于开始时间'); return }
    await saveLearningScheduleEvent({ ...draft, title: draft.title.trim(), notes: draft.notes.trim() }, editingEvent?.id)
    setEventOpen(false); await reload(); await selectDate(draft.localDate); toast.success(editingEvent ? '日程已更新' : '日程已添加')
  }
  const removeEvent = async (event: LearningScheduleEvent) => { await deleteLearningScheduleEvent(event.id); await reload(); toast.success('日程已删除') }
  const dropEvent = async (eventId: string, nextDate: string) => {
    const event = events.find(item => item.id === eventId)
    if (!event || event.localDate === nextDate) return
    await saveLearningScheduleEvent({ title: event.title, localDate: nextDate, startTime: event.startTime, endTime: event.endTime, allDay: event.allDay, kind: event.kind, notes: event.notes }, event.id)
    await reload(); toast.success(`已移动到 ${nextDate}`)
  }

  const renderEvent = (event: LearningScheduleEvent) => <button key={event.id} draggable onDragStart={e => e.dataTransfer.setData('text/learning-event', event.id)} type="button" onClick={e => { e.stopPropagation(); openEdit(event) }} className={cn('flex w-full items-center gap-1 truncate rounded px-1.5 py-1 text-left text-[11px]', event.kind === 'milestone' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-primary/10 text-primary')} title={event.title}>{event.kind === 'milestone' ? <Flag className="size-3 shrink-0" /> : <Clock3 className="size-3 shrink-0" />}<span className="truncate">{event.allDay ? '' : `${event.startTime} `}{event.title}</span></button>
  const dayCell = (cell: string) => {
    const summary = summaryMap.get(cell); const dayEvents = eventMap.get(cell) || []
    return <button key={cell} type="button" onClick={() => void selectDate(cell)} onDoubleClick={() => openCreate(cell)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void dropEvent(e.dataTransfer.getData('text/learning-event'), cell) }} className={cn('flex min-h-28 flex-col gap-1 border-b border-r p-1.5 text-left hover:bg-muted/40', cell === date && 'bg-primary/5 ring-1 ring-inset ring-primary', cell === today && 'font-semibold')}><span className={cn('inline-flex size-6 items-center justify-center rounded-full text-xs', cell === today && 'bg-primary text-primary-foreground')}>{Number(cell.slice(-2))}</span><div className="space-y-1">{dayEvents.slice(0, 3).map(renderEvent)}</div><span className="mt-auto flex justify-between text-[10px] text-muted-foreground"><span>{summary?.taskTotal ? `${summary.taskDone}/${summary.taskTotal} 任务` : ''}</span><span>{summary?.focusedMinutes ? `${summary.focusedMinutes}m` : ''}</span></span></button>
  }

  const renderMonth = () => <Card className="overflow-hidden"><div className="grid grid-cols-7 border-l border-t">{WEEKDAYS.map(day => <div key={day} className="border-b border-r bg-muted/30 py-2 text-center text-xs text-muted-foreground">周{day}</div>)}{monthCells(cursor).map((cell, index) => cell ? dayCell(cell) : <div key={`empty-${index}`} className="min-h-28 border-b border-r bg-muted/10" />)}</div></Card>
  const renderWeek = () => { const start = startOfWeek(dateKey(cursor)); return <Card className="overflow-hidden"><div className="grid grid-cols-7 border-l border-t">{Array.from({ length: 7 }, (_, index) => addLocalDays(start, index)).map((cell, index) => <div key={cell} className="min-h-[430px] border-b border-r p-2" onDragOver={e => e.preventDefault()} onDrop={e => void dropEvent(e.dataTransfer.getData('text/learning-event'), cell)}><button className="mb-3 w-full text-left" onClick={() => void selectDate(cell)}><p className="text-xs text-muted-foreground">周{WEEKDAYS[index]}</p><p className={cn('mt-1 text-lg font-semibold', cell === today && 'text-primary')}>{Number(cell.slice(-2))}</p></button><div className="space-y-1">{(eventMap.get(cell) || []).map(renderEvent)}</div><div className="mt-3 space-y-1 text-xs text-muted-foreground">{summaryMap.get(cell)?.taskTotal ? <p><ListChecks className="mr-1 inline size-3" />{summaryMap.get(cell)?.taskDone}/{summaryMap.get(cell)?.taskTotal} 任务</p> : null}{summaryMap.get(cell)?.focusedMinutes ? <p><Clock3 className="mr-1 inline size-3" />{summaryMap.get(cell)?.focusedMinutes} 分钟</p> : null}</div></div>)}</div></Card> }
  const renderDay = () => <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]"><Card><CardHeader><CardTitle>{formatChineseDate(date)}</CardTitle><CardDescription>双击空白区域添加日程。</CardDescription></CardHeader><CardContent className="space-y-2">{selectedEvents.length ? selectedEvents.map(event => <div key={event.id} className="flex items-start gap-3 rounded-lg border p-3"><div className="w-20 shrink-0 text-sm text-muted-foreground">{event.allDay ? '全天' : `${event.startTime}–${event.endTime}`}</div><div className="min-w-0 flex-1"><p className="font-medium">{event.title}</p>{event.notes ? <p className="mt-1 text-sm text-muted-foreground">{event.notes}</p> : null}</div><Button size="icon-sm" variant="ghost" onClick={() => openEdit(event)}><Pencil /></Button></div>) : <button className="w-full rounded-lg border border-dashed py-16 text-sm text-muted-foreground" onDoubleClick={() => openCreate(date)}>没有日程，双击添加</button>}</CardContent></Card><SelectedDayPanel date={date} summary={selectedSummary} tasks={tasks} onNavigate={onNavigate} onCreate={() => openCreate(date)} /></div>
  const renderYear = () => <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 12 }, (_, month) => { const current = new Date(cursor.getFullYear(), month, 1); return <Card key={month} className="cursor-pointer hover:border-primary/40" onClick={() => { setCursor(current); setView('month') }}><CardHeader className="pb-2"><CardTitle className="text-sm">{month + 1} 月</CardTitle></CardHeader><CardContent><div className="grid grid-cols-7 gap-1">{monthCells(current).map((cell, index) => cell ? <span key={cell} title={`${cell} · ${summaryMap.get(cell)?.focusedMinutes || 0} 分钟`} className={cn('aspect-square rounded-sm text-center text-[9px] leading-5', summaryMap.get(cell)?.focusedMinutes ? 'bg-primary/30' : 'bg-muted/40', cell === today && 'ring-1 ring-primary')}>{Number(cell.slice(-2))}</span> : <span key={`e-${index}`} />)}</div></CardContent></Card> })}</div>
  const agendaRows = [...events].sort((a, b) => a.localDate.localeCompare(b.localDate) || (a.startTime || '').localeCompare(b.startTime || ''))
  const renderAgenda = () => <Card><CardHeader><CardTitle>未来 60 天议程</CardTitle><CardDescription>搜索结果会同时过滤标题和备注。</CardDescription></CardHeader><CardContent className="space-y-1">{agendaRows.length ? agendaRows.map(event => <button key={event.id} className="flex w-full items-center gap-4 rounded-lg border p-3 text-left hover:bg-muted/40" onClick={() => { void selectDate(event.localDate); openEdit(event) }}><div className="w-24 shrink-0"><p className="font-medium">{event.localDate}</p><p className="text-xs text-muted-foreground">{event.allDay ? '全天' : event.startTime}</p></div>{event.kind === 'milestone' ? <Flag className="size-4 text-amber-500" /> : <Clock3 className="size-4 text-primary" />}<div className="min-w-0 flex-1"><p className="truncate font-medium">{event.title}</p><p className="truncate text-xs text-muted-foreground">{event.notes}</p></div></button>) : <p className="py-12 text-center text-sm text-muted-foreground">没有符合条件的日程。</p>}</CardContent></Card>

  return <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">学习日程</h1><p className="text-sm text-muted-foreground">目标、任务、里程碑、专注和报告共用一条时间线。</p></div><Button onClick={() => openCreate()}><Plus />添加日程</Button></div><div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2"><div className="flex"><Button size="icon-sm" variant="ghost" onClick={() => move(-1)}><ChevronLeft /></Button><Button variant="ghost" onClick={() => { setCursor(toDate(today)); void selectDate(today) }}>今天</Button><Button size="icon-sm" variant="ghost" onClick={() => move(1)}><ChevronRight /></Button></div><strong className="min-w-36 text-sm">{view === 'year' ? `${cursor.getFullYear()} 年` : view === 'month' ? `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月` : formatChineseDate(dateKey(cursor))}</strong><div className="flex rounded-md bg-muted p-0.5">{(Object.keys(viewLabel) as CalendarView[]).map(item => <Button key={item} size="sm" variant={view === item ? 'secondary' : 'ghost'} className="h-7 px-2.5" onClick={() => setView(item)}>{viewLabel[item]}</Button>)}</div><div className="relative ml-auto min-w-48 flex-1 sm:max-w-64"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="搜索日程…" value={query} onChange={e => setQuery(e.target.value)} /></div></div>{view === 'month' ? renderMonth() : view === 'week' ? renderWeek() : view === 'day' ? renderDay() : view === 'year' ? renderYear() : renderAgenda()}{view !== 'day' ? <SelectedDayPanel date={date} summary={selectedSummary} tasks={tasks} onNavigate={onNavigate} onCreate={() => openCreate(date)} /> : null}<Dialog open={eventOpen} onOpenChange={setEventOpen}><DialogContent><DialogHeader><DialogTitle>{editingEvent ? '编辑日程' : '添加日程'}</DialogTitle><DialogDescription>里程碑和普通安排都会显示在学习日程中，可在月/周视图拖拽改期。</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label htmlFor="event-title">标题</Label><Input id="event-title" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="event-date">日期</Label><Input id="event-date" type="date" value={draft.localDate} onChange={e => setDraft({ ...draft, localDate: e.target.value })} /></div><div className="space-y-2"><Label>类型</Label><Select value={draft.kind} onValueChange={kind => setDraft({ ...draft, kind: kind as SaveLearningScheduleEventInput['kind'] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="schedule">普通日程</SelectItem><SelectItem value="milestone">里程碑</SelectItem></SelectContent></Select></div></div><div className="flex items-center justify-between rounded-lg border p-3"><Label htmlFor="event-all-day">全天</Label><Switch id="event-all-day" checked={draft.allDay} onCheckedChange={allDay => setDraft({ ...draft, allDay })} /></div>{!draft.allDay ? <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>开始</Label><Input type="time" value={draft.startTime || ''} onChange={e => setDraft({ ...draft, startTime: e.target.value })} /></div><div className="space-y-2"><Label>结束</Label><Input type="time" value={draft.endTime || ''} onChange={e => setDraft({ ...draft, endTime: e.target.value })} /></div></div> : null}<div className="space-y-2"><Label>备注</Label><Textarea value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></div></div><DialogFooter className="justify-between">{editingEvent ? <Button variant="destructive" onClick={() => void removeEvent(editingEvent).then(() => setEventOpen(false))}><Trash2 />删除</Button> : <span />}<div className="flex gap-2"><Button variant="outline" onClick={() => setEventOpen(false)}>取消</Button><Button disabled={!draft.title.trim()} onClick={() => void saveEvent()}>保存</Button></div></DialogFooter></DialogContent></Dialog></div>
}

function SelectedDayPanel({ date, summary, tasks, onNavigate, onCreate }: { date: string; summary?: LearningDaySummary; tasks: ReturnType<typeof useLearningStore.getState>['tasks']; onNavigate: (tab: 'today' | 'reports') => void; onCreate: () => void }) {
  return <Card><CardHeader className="flex-row items-start justify-between"><div><CardTitle className="text-base">{formatChineseDate(date)}</CardTitle><CardDescription>当天任务与学习记录</CardDescription></div><Button size="sm" variant="outline" onClick={onCreate}><Plus />日程</Button></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap gap-2"><Badge variant="outline"><ListChecks />{summary?.taskDone || 0}/{summary?.taskTotal || 0} 任务</Badge><Badge variant="outline"><Clock3 />{summary?.focusedMinutes || 0} 分钟</Badge>{summary?.hasReport ? <Badge><CalendarCheck2 />已有日报</Badge> : null}</div><div className="grid gap-2 sm:grid-cols-2">{tasks.filter(task => task.status !== 'cancelled').map(task => <div key={task.id} className="flex items-center justify-between rounded-md border p-2.5 text-sm"><span className={task.status === 'done' ? 'text-muted-foreground line-through' : ''}>{task.title}</span><span className="text-xs text-muted-foreground">{task.plannedMinutes}m</span></div>)}</div><div className="flex gap-2"><Button variant="outline" onClick={() => onNavigate('today')}><List />查看任务</Button><Button onClick={() => onNavigate('reports')}><FileText />{summary?.hasReport ? '查看日报' : '填写日报'}</Button></div></CardContent></Card>
}
