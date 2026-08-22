'use client'

import { useEffect, useState } from 'react'
import { MessageSquarePlus, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import useChatStore from '@/stores/chat'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import ChatContent from '@/app/core/main/chat/chat-content'
import { ChatInput } from '@/app/core/main/chat/chat-input'
import { ChatFooter } from '@/app/core/main/chat/chat-footer'
import { ClipboardListener } from '@/app/core/main/chat/clipboard-listener'
import { answerHarnessQuestions, cancelHarnessQuestions } from '@/lib/deepseek-harness/interaction'

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
    <div className="mx-3 mb-2 max-h-[45vh] shrink-0 overflow-auto rounded-2xl border border-primary/25 bg-background p-3 shadow-lg">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="size-5 text-primary" />
        AI 助手需要你的回答
      </div>
      <div className="space-y-4">
        {pending.questions.map(question => (
          <div key={question.id} className="space-y-2">
            {question.header ? <div className="text-[11px] font-medium text-primary">{question.header}</div> : null}
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
                        active ? 'border-primary bg-primary/10' : 'hover:bg-muted/60',
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
              className="min-h-16 w-full resize-y rounded-lg border bg-transparent px-3 py-2 text-xs outline-none focus:border-primary"
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
          className="bg-primary text-primary-foreground hover:bg-primary/90"
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
  const currentConversationId = useChatStore(state => state.currentConversationId)
  const conversations = useChatStore(state => state.conversations)
  const agentRunning = useChatStore(state => state.agentState.isRunning)
  const startNewConversation = useChatStore(state => state.startNewConversation)
  const t = useTranslations('record.chat.empty')

  const currentTitle = conversations.find(item => item.id === currentConversationId)?.title
    || t('conversationHistory')

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{currentTitle}</div>
        {agentRunning ? <span className="size-2 animate-pulse rounded-full bg-primary" title="AI 助手正在运行" /> : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-lg"
          onClick={() => void startNewConversation()}
          title="新会话"
        >
          <MessageSquarePlus className="size-4" />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatContent />
        <ClipboardListener />
        <HarnessQuestionPanel />
        <ChatInput />
        <ChatFooter />
      </div>
    </div>
  )
}
