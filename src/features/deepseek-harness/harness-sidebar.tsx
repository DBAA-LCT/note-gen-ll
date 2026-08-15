'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  History,
  ListTree,
  MessageSquarePlus,
  PanelLeft,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import useChatStore from '@/stores/chat'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import ChatContent from '@/app/core/main/chat/chat-content'
import { ChatInput } from '@/app/core/main/chat/chat-input'
import { ChatFooter } from '@/app/core/main/chat/chat-footer'
import { ClipboardListener } from '@/app/core/main/chat/clipboard-listener'
import { AgentRunTimeline } from '@/app/core/main/chat/agent-run-timeline'
import { FishLogo } from './fish-logo'
import type { HarnessSessionEvent } from '@/lib/deepseek-harness/events'
import { answerHarnessQuestions, cancelHarnessQuestions } from '@/lib/deepseek-harness/interaction'

type DetailView = 'trajectory' | 'tools'

const eventLabels: Record<HarnessSessionEvent['kind'], string> = {
  'session/start': '会话启动',
  'turn/start': '开始新一轮',
  'user/message': '用户消息',
  'run/start': 'Agent 启动',
  'run/status': '状态更新',
  'trace/event': '模型轨迹',
  'tool/call': '调用工具',
  'tool/result': '工具结果',
  'step/complete': '完成步骤',
  'assistant/message': 'Agent 回复',
  'run/end': '运行完成',
  'run/error': '运行失败',
  'run/stopped': '运行停止',
}

function eventSummary(event: HarnessSessionEvent) {
  const data = event.data && typeof event.data === 'object'
    ? event.data as Record<string, unknown>
    : {}
  if (typeof data.status === 'string') return data.status
  if (typeof data.toolName === 'string') return data.toolName
  if (typeof data.title === 'string') return data.title
  if (typeof data.message === 'string') return data.message
  if (typeof data.content === 'string') return data.content
  return ''
}

function HarnessBrand() {
  return (
    <div className="flex min-w-0 items-center gap-2 text-foreground">
      <FishLogo size={24} className="shrink-0 text-[#4d6bfe]" />
      <span className="truncate text-[15px] font-semibold tracking-[-0.02em]">deepseek</span>
      <span className="rounded bg-foreground px-1.5 py-0.5 text-[8px] font-bold tracking-[0.12em] text-background">
        HARNESS
      </span>
    </div>
  )
}

function SessionBrowser({ compact, onSelect }: { compact: boolean; onSelect?: () => void }) {
  const {
    conversations,
    currentConversationId,
    switchConversation,
    startNewConversation,
    loading,
  } = useChatStore()

  const sessions = useMemo(() => [...conversations]
    .filter(conversation => conversation.messageCount > 0 || conversation.id === currentConversationId)
    .sort((left, right) => {
      if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1
      return right.updatedAt - left.updatedAt
    }), [conversations, currentConversationId])

  if (compact) {
    return (
      <div className="flex flex-1 flex-col items-center gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 rounded-xl"
          onClick={() => void startNewConversation()}
          disabled={loading}
          title="新会话"
        >
          <MessageSquarePlus className="size-[18px]" />
        </Button>
        <div className="h-px w-6 bg-border/70" />
        <History className="mt-1 size-4 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Button
        type="button"
        variant="outline"
        className="mx-2 mb-3 h-10 justify-center rounded-xl bg-background/80 shadow-sm"
        onClick={() => void startNewConversation()}
        disabled={loading}
      >
        <MessageSquarePlus className="size-4" />
        <span>新会话</span>
      </Button>
      <div className="px-3 pb-1 text-[11px] font-medium text-muted-foreground">会话</div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 px-2 pb-3">
          {sessions.map(session => {
            const active = session.id === currentConversationId
            return (
              <button
                key={session.id}
                type="button"
                className={cn(
                  'group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                  active
                    ? 'bg-[#4d6bfe]/10 text-foreground'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                )}
                onClick={() => {
                  void switchConversation(session.id)
                  onSelect?.()
                }}
              >
                <span className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-[#4d6bfe]' : 'bg-muted-foreground/35')} />
                <span className="min-w-0 flex-1 truncate">{session.title || '新会话'}</span>
                {active ? <ChevronRight className="size-3.5 shrink-0 text-[#4d6bfe]" /> : null}
              </button>
            )
          })}
          {sessions.length === 0 ? (
            <div className="px-2 py-8 text-center text-xs text-muted-foreground">还没有会话</div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}

function HarnessDetails({
  view,
  onViewChange,
  overlay = false,
}: {
  view: DetailView
  onViewChange: (view: DetailView) => void
  overlay?: boolean
}) {
  const agentState = useChatStore(state => state.agentState)
  const events = agentState.traceEvents || []
  const harnessEvents = agentState.harnessEvents || []
  const toolCalls = agentState.toolCalls || []

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 shrink-0 flex-col border-l bg-background',
        overlay ? 'w-full' : 'w-[min(360px,42%)]',
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
        <Button
          type="button"
          size="sm"
          variant={view === 'trajectory' ? 'secondary' : 'ghost'}
          className="h-8 rounded-lg"
          onClick={() => onViewChange('trajectory')}
        >
          <ListTree className="size-4" />
          轨迹
        </Button>
        <Button
          type="button"
          size="sm"
          variant={view === 'tools' ? 'secondary' : 'ghost'}
          className="h-8 rounded-lg"
          onClick={() => onViewChange('tools')}
        >
          <Wrench className="size-4" />
          工具
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          {view === 'trajectory' ? (
            harnessEvents.length ? (
              <div className="space-y-1.5">
                {harnessEvents.map(event => {
                  const summary = eventSummary(event)
                  return (
                    <div key={event.id} className="flex gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/50">
                      <span className={cn(
                        'mt-1.5 size-1.5 shrink-0 rounded-full',
                        event.kind === 'run/error' ? 'bg-destructive' : event.kind === 'run/end' ? 'bg-emerald-500' : 'bg-[#4d6bfe]'
                      )} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="font-medium">{eventLabels[event.kind]}</span>
                          <span className="ml-auto text-[9px] tabular-nums text-muted-foreground">#{event.sequence}</span>
                        </div>
                        {summary ? <p className="mt-0.5 line-clamp-3 break-words text-[10px] text-muted-foreground">{summary}</p> : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <AgentRunTimeline
                status={agentState.status}
                isRunning={agentState.isRunning}
                traceEvents={events}
                toolCalls={toolCalls}
                ragSources={agentState.ragSources}
                ragSourceDetails={agentState.ragSourceDetails}
                loadedSkills={agentState.loadedSkills}
              />
            )
          ) : toolCalls.length ? (
            <div className="space-y-2">
              {toolCalls.map(call => (
                <div key={call.id} className="rounded-xl border bg-muted/25 p-3">
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <span className={cn(
                      'size-2 rounded-full',
                      call.status === 'success' ? 'bg-emerald-500' : call.status === 'error' ? 'bg-destructive' : 'bg-amber-500'
                    )} />
                    <span className="truncate">{call.toolName}</span>
                  </div>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px] text-muted-foreground">
                    {JSON.stringify(call.params, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <Wrench className="size-5" />
              <span className="text-xs">工具调用会显示在这里</span>
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}

function HarnessQuestionPanel() {
  const pending = useChatStore(state => state.agentState.pendingHarnessQuestions)
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})

  useEffect(() => {
    setSelected({})
    setCustom({})
  }, [pending?.token])

  if (!pending) return null
  const complete = pending.questions.every(question => (
    (selected[question.id]?.length || 0) > 0 || Boolean(custom[question.id]?.trim())
  ))

  return (
    <div className="mx-3 mb-2 max-h-[45vh] shrink-0 overflow-auto rounded-2xl border border-[#4d6bfe]/25 bg-background p-3 shadow-lg">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <FishLogo size={20} className="text-[#4d6bfe]" />
        Harness 需要你的回答
      </div>
      <div className="space-y-4">
        {pending.questions.map(question => (
          <div key={question.id} className="space-y-2">
            {question.header ? <div className="text-[11px] font-medium text-[#4d6bfe]">{question.header}</div> : null}
            <div className="text-sm font-medium">{question.question}</div>
            {question.detail ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">{question.detail}</pre> : null}
            {question.options?.length ? (
              <div className="grid gap-1.5">
                {question.options.map(option => {
                  const active = selected[question.id]?.includes(option.label) || false
                  return (
                    <button
                      key={option.label}
                      type="button"
                      className={cn(
                        'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                        active ? 'border-[#4d6bfe] bg-[#4d6bfe]/10' : 'hover:bg-muted/60',
                      )}
                      onClick={() => setSelected(current => {
                        const values = current[question.id] || []
                        return {
                          ...current,
                          [question.id]: question.multiSelect
                            ? (active ? values.filter(value => value !== option.label) : [...values, option.label])
                            : [option.label],
                        }
                      })}
                    >
                      <div className="font-medium">{option.label}</div>
                      {option.description ? <div className="mt-0.5 text-muted-foreground">{option.description}</div> : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
            <textarea
              value={custom[question.id] || ''}
              onChange={event => setCustom(current => ({ ...current, [question.id]: event.target.value }))}
              placeholder="其他回答（可选）"
              className="min-h-16 w-full resize-y rounded-lg border bg-transparent px-3 py-2 text-xs outline-none focus:border-[#4d6bfe]"
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => cancelHarnessQuestions(pending.token)}>取消</Button>
        <Button
          type="button"
          size="sm"
          disabled={!complete}
          className="bg-[#4d6bfe] text-white hover:bg-[#405be0]"
          onClick={() => answerHarnessQuestions(pending.token, pending.questions.map(question => ({
            id: question.id,
            selected: selected[question.id] || [],
            ...(custom[question.id]?.trim() ? { custom: custom[question.id].trim() } : {}),
          })))}
        >
          提交回答
        </Button>
      </div>
    </div>
  )
}

export function DeepSeekHarnessSidebar() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  const [navigationOpen, setNavigationOpen] = useState(true)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailView, setDetailView] = useState<DetailView>('trajectory')
  const currentConversationId = useChatStore(state => state.currentConversationId)
  const conversations = useChatStore(state => state.conversations)
  const agentRunning = useChatStore(state => state.agentState.isRunning)
  const openSettings = useSettingsDialogStore(state => state.openSettings)
  const t = useTranslations('record.chat.empty')

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width || root.clientWidth
      setNarrow(width < 720)
      if (width < 540) setNavigationOpen(false)
      if (width < 660) setDetailsOpen(false)
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  const currentTitle = conversations.find(item => item.id === currentConversationId)?.title
    || t('conversationHistory')

  return (
    <div ref={rootRef} className="relative flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground">
      <aside className={cn(
        'z-20 flex h-full min-h-0 shrink-0 flex-col border-r bg-muted/20 transition-[width] duration-200',
        navigationOpen ? 'w-[230px]' : 'w-14',
        narrow && navigationOpen && 'absolute inset-y-0 left-0 shadow-2xl'
      )}>
        <div className={cn('flex h-[68px] shrink-0 items-center px-3', navigationOpen ? 'justify-between' : 'justify-center')}>
          {navigationOpen ? <HarnessBrand /> : <FishLogo size={25} className="text-[#4d6bfe]" />}
          {navigationOpen ? (
            <Button type="button" variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => setNavigationOpen(false)}>
              <PanelLeft className="size-4" />
            </Button>
          ) : null}
        </div>
        {!navigationOpen ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mx-auto mb-1 size-9 rounded-xl"
            onClick={() => setNavigationOpen(true)}
            title="展开 Harness"
          >
            <ChevronRight className="size-4" />
          </Button>
        ) : null}
        <SessionBrowser compact={!navigationOpen} onSelect={narrow ? () => setNavigationOpen(false) : undefined} />
        <div className={cn('shrink-0 border-t p-2', navigationOpen ? 'space-y-1' : 'flex flex-col items-center gap-1')}>
          <Button type="button" variant="ghost" className={cn('h-9 rounded-lg', navigationOpen ? 'w-full justify-start' : 'size-9 p-0')} onClick={() => openSettings('skills')}>
            <Sparkles className="size-4" />
            {navigationOpen ? <span>Skills</span> : null}
          </Button>
          <Button type="button" variant="ghost" className={cn('h-9 rounded-lg', navigationOpen ? 'w-full justify-start' : 'size-9 p-0')} onClick={() => openSettings('mcp')}>
            <SlidersHorizontal className="size-4" />
            {navigationOpen ? <span>插件与 MCP</span> : null}
          </Button>
          <Button type="button" variant="ghost" className={cn('h-9 rounded-lg', navigationOpen ? 'w-full justify-start' : 'size-9 p-0')} onClick={() => openSettings('ai')}>
            <Settings className="size-4" />
            {navigationOpen ? <span>设置</span> : null}
          </Button>
        </div>
      </aside>

      {narrow && navigationOpen ? (
        <button type="button" className="absolute inset-0 z-10 bg-black/20" aria-label="关闭会话栏" onClick={() => setNavigationOpen(false)} />
      ) : null}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          {!navigationOpen ? (
            <Button type="button" variant="ghost" size="icon" className="size-8 rounded-lg" onClick={() => setNavigationOpen(true)}>
              <ChevronRight className="size-4" />
            </Button>
          ) : null}
          <div className="min-w-0 flex-1 truncate text-sm font-medium">{currentTitle}</div>
          {agentRunning ? <span className="size-2 animate-pulse rounded-full bg-[#4d6bfe]" title="Agent 正在运行" /> : null}
          <Button
            type="button"
            variant={detailsOpen ? 'secondary' : 'ghost'}
            size="icon"
            className="size-8 rounded-lg"
            onClick={() => setDetailsOpen(value => !value)}
            title="运行详情"
          >
            <ListTree className="size-4" />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            <ChatContent />
            <ClipboardListener />
            <HarnessQuestionPanel />
            <ChatInput />
            <ChatFooter />
          </section>
          {detailsOpen && !narrow ? <HarnessDetails view={detailView} onViewChange={setDetailView} /> : null}
        </div>
      </main>

      {detailsOpen && narrow ? (
        <div className="absolute inset-y-0 right-0 z-30 flex w-[min(420px,92%)] shadow-2xl">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute left-0 top-2 z-10 size-8 -translate-x-full rounded-r-none"
            onClick={() => setDetailsOpen(false)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <HarnessDetails view={detailView} onViewChange={setDetailView} overlay />
        </div>
      ) : null}
    </div>
  )
}
