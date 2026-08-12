'use client'

import { MessageCircleQuestion, PencilLine } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import emitter from '@/lib/emitter'
import type { ToolCall } from '@/lib/agent/types'

type InterviewOption = {
  label: string
  value: string
  description: string
}

export type LearningInterviewQuestion = {
  kind: 'learning-interview-question'
  topic: string
  question: string
  answerMode: 'direct' | 'draft'
  options: InterviewOption[]
  allowFreeText: boolean
}

function asInterviewQuestion(value: unknown): LearningInterviewQuestion | null {
  if (!value || typeof value !== 'object') return null
  const question = value as Record<string, unknown>
  if (question.kind !== 'learning-interview-question' || typeof question.question !== 'string' || !question.question.trim()) return null
  const options = Array.isArray(question.options)
    ? question.options.map(value => value && typeof value === 'object' ? value as Record<string, unknown> : {}).map(option => ({
      label: String(option.label || ''),
      value: String(option.value || ''),
      description: String(option.description || ''),
    })).filter(option => option.label && option.value)
    : []
  return {
    kind: 'learning-interview-question',
    topic: String(question.topic || ''),
    question: question.question.trim(),
    answerMode: question.answerMode === 'draft' ? 'draft' : 'direct',
    options,
    allowFreeText: question.allowFreeText !== false,
  }
}

export function getLearningInterviewQuestions(toolCalls: ToolCall[]): LearningInterviewQuestion[] {
  return toolCalls
    .filter(call => call.toolName === 'learning_ask_interview_question' && call.status === 'success')
    .map(call => asInterviewQuestion(call.result?.data))
    .filter((question): question is LearningInterviewQuestion => Boolean(question))
    .slice(-1)
}

export function LearningInterviewQuestionCard({ question, interactive }: { question: LearningInterviewQuestion, interactive: boolean }) {
  const [directSubmitted, setDirectSubmitted] = useState(false)

  const answer = (value: string) => {
    if (!interactive || directSubmitted) return
    if (question.answerMode === 'direct') setDirectSubmitted(true)
    emitter.emit(question.answerMode === 'direct' ? 'quick-prompt-send' : 'quick-prompt-insert', value)
  }

  const focusFreeText = () => {
    if (interactive) emitter.emit('quick-prompt-insert', '')
  }

  return (
    <div className={`rounded-lg border bg-card p-4 shadow-sm ${interactive ? '' : 'opacity-70'}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary"><MessageCircleQuestion className="size-4" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">
            {question.answerMode === 'direct' ? '学习访谈 · 选择一个答案' : '学习访谈 · 选择一个回答草稿'}
          </p>
          <p className="mt-1 text-sm font-medium leading-6">{question.question}</p>
        </div>
      </div>
      {question.options.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {question.options.map(option => (
            <Button
              key={`${option.label}-${option.value}`}
              type="button"
              variant="outline"
              disabled={!interactive || directSubmitted}
              className="h-auto min-h-10 justify-start whitespace-normal px-3 py-2 text-left"
              onClick={() => answer(option.value)}
            >
              <span>
                <span className="block font-medium">{option.label}</span>
                {option.description ? <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{option.description}</span> : null}
              </span>
            </Button>
          ))}
        </div>
      )}
      {question.allowFreeText && interactive && (
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{question.answerMode === 'direct' ? '点击选项将直接回答，也可以自由输入。' : '点击选项会覆盖输入框，你可以修改后再发送。'}</span>
          <Button type="button" size="sm" variant="ghost" onClick={focusFreeText}><PencilLine />自由回答</Button>
        </div>
      )}
      {!interactive && <p className="mt-3 text-xs text-muted-foreground">此问题已结束，请回答最新的问题。</p>}
    </div>
  )
}
