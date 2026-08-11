'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Brain, CheckCircle2, CloudDownload, FileText, Library, LoaderCircle, Plus, RotateCcw, Settings2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { gradeLearningAnswerWithAi } from '@/lib/learning/ai'
import { isTauriRuntime } from '@/lib/check'
import { getMaimemoTodayItems, getMaimemoToken, getMarkjiDeckCards, listMarkjiDecks, type MarkjiDeck } from '@/lib/learning/maimemo'
import {
  deleteLearningKnowledgeBase,
  deleteLearningKnowledgeItem,
  getLearningReviewSettings,
  listLearningKnowledgeBases,
  listLearningKnowledgeItems,
  listLearningReviewAttempts,
  listLearningReviewStates,
  saveLearningKnowledgeBase,
  saveLearningKnowledgeItem,
  saveLearningReviewAttempt,
  saveLearningReviewSettings,
} from '@/lib/learning/repository'
import { deterministicGrade, parseLearningItems, scheduleReview, selectReviewItems } from '@/lib/learning/review-scheduler'
import useLearningStore from '@/stores/learning'
import type { LearningItemType, LearningKnowledgeBase, LearningKnowledgeItem, LearningReviewAttempt, LearningReviewSettings, LearningReviewState } from '@/types/learning'

function uuid() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}` }

export function KnowledgeReviewView() {
  const date = useLearningStore(state => state.date)
  const goals = useLearningStore(state => state.goals)
  const [activeFilePath, setActiveFilePath] = useState('')
  const [bases, setBases] = useState<LearningKnowledgeBase[]>([])
  const [items, setItems] = useState<LearningKnowledgeItem[]>([])
  const [states, setStates] = useState<LearningReviewState[]>([])
  const [attempts, setAttempts] = useState<LearningReviewAttempt[]>([])
  const [settings, setSettings] = useState<LearningReviewSettings | null>(null)
  const [selectedBaseId, setSelectedBaseId] = useState('all')
  const [baseOpen, setBaseOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [baseName, setBaseName] = useState('')
  const [baseDescription, setBaseDescription] = useState('')
  const [baseGoalId, setBaseGoalId] = useState('none')
  const [importType, setImportType] = useState<LearningItemType>('concept')
  const [importText, setImportText] = useState('')
  const [busy, setBusy] = useState(false)
  const [decks, setDecks] = useState<MarkjiDeck[]>([])
  const [quizItems, setQuizItems] = useState<LearningKnowledgeItem[]>([])
  const [quizIndex, setQuizIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [pendingGrade, setPendingGrade] = useState<0 | 1 | 2 | 3 | null>(null)

  const reload = useCallback(async () => {
    const [nextBases, nextItems, nextStates, nextAttempts, nextSettings] = await Promise.all([
      listLearningKnowledgeBases(), listLearningKnowledgeItems(), listLearningReviewStates(), listLearningReviewAttempts(), getLearningReviewSettings(),
    ])
    setBases(nextBases); setItems(nextItems); setStates(nextStates); setAttempts(nextAttempts); setSettings(nextSettings)
  }, [])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    if (!isTauriRuntime()) return
    let unsubscribe: (() => void) | undefined
    void import('@/stores/article').then(({ default: useArticleStore }) => {
      setActiveFilePath(useArticleStore.getState().activeFilePath)
      unsubscribe = useArticleStore.subscribe(state => setActiveFilePath(state.activeFilePath))
    })
    return () => unsubscribe?.()
  }, [])

  const stateMap = useMemo(() => new Map(states.map(item => [item.itemId, item])), [states])
  const filteredItems = selectedBaseId === 'all' ? items : items.filter(item => item.knowledgeBaseId === selectedBaseId)
  const dueCount = items.filter(item => !stateMap.has(item.id) || stateMap.get(item.id)!.dueDate <= date).length
  const masteredCount = states.filter(item => item.mastery >= 80).length
  const todayAttempts = attempts.filter(item => item.localDate === date)

  const createBase = async () => {
    if (!baseName.trim()) return
    await saveLearningKnowledgeBase({ name: baseName.trim(), description: baseDescription.trim(), goalId: baseGoalId === 'none' ? null : baseGoalId, source: 'notegen' })
    setBaseName(''); setBaseDescription(''); setBaseOpen(false); await reload(); toast.success('知识库已创建')
  }

  const importRows = async () => {
    const targetBase = selectedBaseId === 'all' ? bases[0]?.id : selectedBaseId
    if (!targetBase) { toast.error('请先创建或选择知识库'); return }
    const rows = parseLearningItems(importText, importType)
    if (!rows.length) { toast.error('没有解析到有效条目'); return }
    setBusy(true)
    try {
      for (const row of rows) await saveLearningKnowledgeItem({ ...row, knowledgeBaseId: targetBase, notePath: activeFilePath || null })
      setImportText(''); setImportOpen(false); await reload(); toast.success(`已导入 ${rows.length} 个知识条目`)
    } finally { setBusy(false) }
  }

  const ensureExternalBase = async (source: LearningKnowledgeBase['source'], name: string) => {
    const existing = bases.find(item => item.source === source && (source !== 'maimemo-markji' || item.name === name))
    if (existing) return existing
    return saveLearningKnowledgeBase({ name, description: '由墨墨开放 API 同步，复习记录保存在 NoteGen。', goalId: null, source })
  }

  const syncMaimemoToday = async () => {
    if (!await getMaimemoToken()) { toast.error('请先在学习设置中配置墨墨 Token'); return }
    setBusy(true)
    try {
      const base = await ensureExternalBase('maimemo-words', '墨墨今日单词')
      const rows = await getMaimemoTodayItems({ limit: 50 })
      for (const row of rows) await saveLearningKnowledgeItem({ knowledgeBaseId: base.id, type: 'word', prompt: row.voc_spelling, answer: '请根据你在墨墨中的记忆进行自评', tags: [row.is_new ? '今日新词' : '今日复习'], externalId: `maimemo-word:${row.voc_id}`, externalSource: 'maimemo-words', gradingMode: 'self' })
      await reload(); toast.success(`已同步 ${rows.length} 个墨墨今日单词`)
    } catch (error) { toast.error('墨墨同步失败', { description: error instanceof Error ? error.message : String(error) }) }
    finally { setBusy(false) }
  }

  const loadDecks = async () => {
    setBusy(true)
    try { setDecks(await listMarkjiDecks()) }
    catch (error) { toast.error('读取 Markji 牌组失败', { description: error instanceof Error ? error.message : String(error) }) }
    finally { setBusy(false) }
  }

  const syncDeck = async (deck: MarkjiDeck) => {
    setBusy(true)
    try {
      const base = await ensureExternalBase('maimemo-markji', `Markji · ${deck.name}`)
      const cards = await getMarkjiDeckCards(deck.id)
      for (const card of cards) {
        const parts = String(card.content || '').split(/\n-{3,}\n|\n\s*\n|\t|\s+::\s+/).map(value => value.trim()).filter(Boolean)
        await saveLearningKnowledgeItem({ knowledgeBaseId: base.id, type: 'concept', prompt: parts[0] || card.content, answer: parts.slice(1).join('\n') || card.content, tags: ['Markji', deck.name], externalId: `maimemo-card:${card.id}`, externalSource: 'maimemo-markji', gradingMode: parts.length > 1 ? 'answer' : 'self' })
      }
      await reload(); toast.success(`已同步 ${cards.length} 张 Markji 卡片`)
    } catch (error) { toast.error('同步牌组失败', { description: error instanceof Error ? error.message : String(error) }) }
    finally { setBusy(false) }
  }

  const startQuiz = () => {
    if (!settings) return
    const selected = selectReviewItems({ date, items, states, attempts, settings })
    setQuizItems(selected); setQuizIndex(0); setAnswer(''); setRevealed(false); setFeedback(''); setPendingGrade(null)
    if (!selected.length) toast.info('今天没有待复习条目')
  }

  const current = quizItems[quizIndex]
  const recordGrade = async (grade: 0 | 1 | 2 | 3, nextFeedback: string) => {
    if (!current) return
    const previous = stateMap.get(current.id)
    await saveLearningReviewAttempt({ id: uuid(), itemId: current.id, localDate: date, userAnswer: answer, grade, correct: grade >= 2, feedback: nextFeedback, createdAt: Date.now() }, scheduleReview(previous, current.id, date, grade))
    if (quizIndex + 1 < quizItems.length) { setQuizIndex(value => value + 1); setAnswer(''); setRevealed(false); setFeedback(''); setPendingGrade(null) }
    else { setQuizItems([]); await reload(); toast.success('今日知识复习完成') }
  }

  const submitAnswer = async () => {
    if (!current || !answer.trim()) return
    setBusy(true)
    try {
      const exact = deterministicGrade(current, answer)
      if (exact !== null) {
        setFeedback('已按参考答案完成自动评分。')
        setPendingGrade(exact)
        setRevealed(true)
        return
      }
      if (current.gradingMode === 'self') { setRevealed(true); return }
      try {
        const result = await gradeLearningAnswerWithAi({ item: current, answer })
        setFeedback(result.feedback); setPendingGrade(result.grade); setRevealed(true)
      } catch { setRevealed(true); setFeedback('AI 评分不可用，请根据参考答案自评。') }
    } finally { setBusy(false) }
  }

  const updateReviewSettings = async (next: LearningReviewSettings) => { setSettings(next); await saveLearningReviewSettings(next) }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">知识与复习</h1><p className="text-sm text-muted-foreground">知识内容继续来自 NoteGen 笔记；这里管理复习条目、掌握度和外部同步。</p></div>
        <div className="flex gap-2"><Button variant="outline" onClick={() => setBaseOpen(true)}><Plus />知识库</Button><Button onClick={startQuiz}><Brain />开始今日测验</Button></div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardDescription>知识条目</CardDescription><CardTitle>{items.length}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>今日待复习</CardDescription><CardTitle>{dueCount}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>已掌握</CardDescription><CardTitle>{masteredCount}</CardTitle></CardHeader><CardContent><Progress value={items.length ? masteredCount / items.length * 100 : 0} /></CardContent></Card>
      </div>

      <Tabs defaultValue="library">
        <TabsList variant="line"><TabsTrigger value="library"><Library />知识库</TabsTrigger><TabsTrigger value="quiz"><Brain />今日测验</TabsTrigger><TabsTrigger value="connectors"><CloudDownload />外部同步</TabsTrigger><TabsTrigger value="rules"><Settings2 />复习规则</TabsTrigger></TabsList>
        <TabsContent value="library" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
            <Card className="h-fit"><CardHeader><CardTitle className="text-base">知识库</CardTitle></CardHeader><CardContent className="space-y-1">
              <Button variant={selectedBaseId === 'all' ? 'secondary' : 'ghost'} className="w-full justify-between" onClick={() => setSelectedBaseId('all')}><span>全部</span><Badge variant="outline">{items.length}</Badge></Button>
              {bases.map(base => <Button key={base.id} variant={selectedBaseId === base.id ? 'secondary' : 'ghost'} className="w-full justify-between" onClick={() => setSelectedBaseId(base.id)}><span className="truncate">{base.name}</span><Badge variant="outline">{items.filter(item => item.knowledgeBaseId === base.id).length}</Badge></Button>)}
              {selectedBaseId !== 'all' ? <Button variant="ghost" className="mt-3 w-full justify-start text-destructive" onClick={() => { if (window.confirm('删除该知识库及其复习条目？原始 NoteGen 笔记不会被删除。')) void deleteLearningKnowledgeBase(selectedBaseId).then(() => { setSelectedBaseId('all'); return reload() }) }}><Trash2 />删除当前知识库</Button> : null}
            </CardContent></Card>
            <Card><CardHeader className="flex-row items-start justify-between"><div><CardTitle>知识条目</CardTitle><CardDescription>每行可导入“问题 | 答案 | 别名 | 标签 | 说明”，条目可回链到当前笔记。</CardDescription></div><Button size="sm" onClick={() => setImportOpen(true)}><Plus />导入</Button></CardHeader><CardContent className="space-y-2">
              {filteredItems.length ? filteredItems.map(item => <div key={item.id} className="flex items-start gap-3 rounded-lg border p-3"><BookOpen className="mt-0.5 size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{item.prompt}</p><Badge variant="outline">{item.type}</Badge>{item.externalSource ? <Badge variant="secondary">{item.externalSource === 'maimemo-markji' ? 'Markji' : '墨墨'}</Badge> : null}</div><p className="mt-1 text-sm text-muted-foreground">{item.answer}</p>{item.notePath ? <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground"><FileText className="size-3" />{item.notePath}</p> : null}</div><div className="text-right text-xs text-muted-foreground"><p>{stateMap.get(item.id)?.mastery || 0}%</p><p>{stateMap.get(item.id)?.dueDate || '新条目'}</p></div><Button size="icon-sm" variant="ghost" onClick={() => void deleteLearningKnowledgeItem(item.id).then(reload)}><Trash2 /></Button></div>) : <div className="py-12 text-center text-sm text-muted-foreground">还没有知识条目。可从当前笔记整理后导入，或同步墨墨/Markji。</div>}
            </CardContent></Card>
          </div>
        </TabsContent>
        <TabsContent value="quiz" className="mt-4">
          {current ? <Card className="mx-auto max-w-2xl"><CardHeader><div className="flex justify-between text-sm text-muted-foreground"><span>第 {quizIndex + 1} / {quizItems.length} 题</span><Badge variant="outline">{current.type}</Badge></div><CardTitle className="pt-4 text-xl">{current.prompt}</CardTitle></CardHeader><CardContent className="space-y-4"><Textarea rows={4} disabled={revealed} placeholder="输入你的答案…" value={answer} onChange={event => setAnswer(event.target.value)} />{!revealed ? <Button className="w-full" disabled={!answer.trim() || busy} onClick={() => void submitAnswer()}>{busy ? <LoaderCircle className="animate-spin" /> : null}提交答案</Button> : null}{revealed ? <div className="space-y-3 rounded-lg border bg-muted/30 p-4"><div><p className="text-xs text-muted-foreground">参考答案</p><p className="mt-1">{current.answer}</p></div>{feedback ? <p className="text-sm text-muted-foreground">{feedback}</p> : null}{pendingGrade !== null ? <Button className="w-full" onClick={() => void recordGrade(pendingGrade, feedback)}>确认评分并继续</Button> : <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Button variant="outline" onClick={() => void recordGrade(0, '未掌握')}>忘记</Button><Button variant="outline" onClick={() => void recordGrade(1, '模糊')}>模糊</Button><Button variant="outline" onClick={() => void recordGrade(2, '基本掌握')}>基本会</Button><Button onClick={() => void recordGrade(3, '熟练掌握')}>熟练</Button></div>}</div> : null}</CardContent></Card> : <Card><CardContent className="flex flex-col items-center gap-3 py-14 text-center"><CheckCircle2 className="size-10 text-muted-foreground" /><div><p className="font-medium">今日已完成 {todayAttempts.length} 次复习</p><p className="text-sm text-muted-foreground">系统优先选择到期、薄弱和新条目。</p></div><Button onClick={startQuiz}><RotateCcw />生成今日测验</Button></CardContent></Card>}
        </TabsContent>
        <TabsContent value="connectors" className="mt-4"><div className="grid gap-4 md:grid-cols-2"><Card><CardHeader><CardTitle>墨墨今日学习</CardTitle><CardDescription>把今日新词和复习词同步为自评条目。</CardDescription></CardHeader><CardContent><Button disabled={busy} onClick={() => void syncMaimemoToday()}><CloudDownload />同步今日单词</Button></CardContent></Card><Card><CardHeader><CardTitle>Markji 记忆卡</CardTitle><CardDescription>读取同一墨墨 Token 下的 Markji 牌组。</CardDescription></CardHeader><CardContent className="space-y-3"><Button variant="outline" disabled={busy} onClick={() => void loadDecks()}>读取牌组</Button>{decks.map(deck => <div key={deck.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><div className="min-w-0"><p className="truncate font-medium">{deck.name}</p><p className="text-xs text-muted-foreground">{deck.card_count} 张卡片</p></div><Button size="sm" onClick={() => void syncDeck(deck)}>同步</Button></div>)}</CardContent></Card></div></TabsContent>
        <TabsContent value="rules" className="mt-4">{settings ? <Card><CardHeader><CardTitle>每日复习规则</CardTitle><CardDescription>到期条目优先，其次是薄弱条目和新条目。</CardDescription></CardHeader><CardContent className="space-y-5"><div className="flex items-center justify-between"><div><Label htmlFor="review-enabled">启用每日复习</Label><p className="text-xs text-muted-foreground">关闭后不会生成今日题目。</p></div><Switch id="review-enabled" checked={settings.enabled} onCheckedChange={enabled => void updateReviewSettings({ ...settings, enabled })} /></div><div className="space-y-2"><Label htmlFor="daily-review-count">每日题量</Label><Input id="daily-review-count" type="number" min={1} max={50} value={settings.dailyCount} onChange={event => void updateReviewSettings({ ...settings, dailyCount: Math.max(1, Math.min(50, Number(event.target.value) || 1)) })} /></div></CardContent></Card> : null}</TabsContent>
      </Tabs>

      <Dialog open={baseOpen} onOpenChange={setBaseOpen}><DialogContent><DialogHeader><DialogTitle>新建知识库</DialogTitle><DialogDescription>知识库只保存复习元数据，原始资料仍使用 NoteGen 笔记。</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label htmlFor="base-name">名称</Label><Input id="base-name" value={baseName} onChange={event => setBaseName(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="base-desc">说明</Label><Textarea id="base-desc" value={baseDescription} onChange={event => setBaseDescription(event.target.value)} /></div><div className="space-y-2"><Label>关联目标</Label><Select value={baseGoalId} onValueChange={setBaseGoalId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">不关联</SelectItem>{goals.map(goal => <SelectItem key={goal.id} value={goal.id}>{goal.title}</SelectItem>)}</SelectContent></Select></div></div><DialogFooter><Button variant="outline" onClick={() => setBaseOpen(false)}>取消</Button><Button disabled={!baseName.trim()} onClick={() => void createBase()}>创建</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>导入知识条目</DialogTitle><DialogDescription>每行：问题 | 答案 | 别名（/分隔）| 标签（/分隔）| 补充说明。</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label>类型</Label><Select value={importType} onValueChange={value => setImportType(value as LearningItemType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="word">单词</SelectItem><SelectItem value="concept">概念</SelectItem><SelectItem value="formula">公式</SelectItem></SelectContent></Select></div><Textarea rows={10} value={importText} onChange={event => setImportText(event.target.value)} placeholder="线性变换 | 保持向量加法和数乘的映射 | linear map | 线代/概念 | 可用矩阵表示" /></div><DialogFooter><Button variant="outline" onClick={() => setImportOpen(false)}>取消</Button><Button disabled={!importText.trim() || busy} onClick={() => void importRows()}>导入</Button></DialogFooter></DialogContent></Dialog>
    </div>
  )
}
