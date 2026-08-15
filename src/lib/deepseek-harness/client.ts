import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { AiConfig } from '@/app/core/setting/config'
import type { AgentPermissionMode } from '@/lib/agent/types'

export interface HarnessWireNotification {
  id?: string | number
  method: string
  params: Record<string, unknown>
}

export interface HarnessWireEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
  [key: string]: unknown
}

export interface HarnessRunResult {
  sessionId: string
  finalResponse: string
  events: HarnessWireEvent[]
  notifications: HarnessWireNotification[]
}

type Observer = (notification: HarnessWireNotification) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function textFromContent(value: unknown) {
  if (!Array.isArray(value)) return ''
  return value.flatMap(block => (
    isRecord(block) && block.type === 'text' && typeof block.text === 'string'
      ? [block.text]
      : []
  )).join('')
}

function assistantText(event: HarnessWireEvent) {
  if (event.type !== 'assistant/message' || !isRecord(event.data.message)) return ''
  return textFromContent(event.data.message.content)
}

function isReceipt(event: unknown, messageId: string) {
  if (!isRecord(event) || event.type !== 'agent/inbox/spliced' || !isRecord(event.data)) return false
  return Array.isArray(event.data.inserted) && event.data.inserted.some(message => (
    isRecord(message) && message.id === messageId
  ))
}

class NotificationQueue {
  private values: HarnessWireNotification[] = []
  private waiters: Array<{
    resolve: (value: HarnessWireNotification) => void
    reject: (error: Error) => void
  }> = []
  private error?: Error

  push(value: HarnessWireNotification) {
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve(value)
    else this.values.push(value)
  }

  fail(error: Error) {
    if (this.error) return
    this.error = error
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
  }

  next() {
    const value = this.values.shift()
    if (value) return Promise.resolve(value)
    if (this.error) return Promise.reject(this.error)
    return new Promise<HarnessWireNotification>((resolve, reject) => this.waiters.push({ resolve, reject }))
  }
}

class NoteGoalHarnessClient {
  private signature = ''
  private starting?: Promise<void>
  private unlisten?: UnlistenFn
  private unlistenClosed?: UnlistenFn
  private observers = new Set<Observer>()
  private activeQueues = new Set<NotificationQueue>()

  private failActive(error: Error) {
    for (const queue of this.activeQueues) queue.fail(error)
  }

  private async ensureListener() {
    if (this.unlisten) return
    this.unlisten = await listen<HarnessWireNotification>('deepseek-harness://notification', event => {
      const notification = event.payload
      if (!notification || typeof notification.method !== 'string' || !isRecord(notification.params)) return
      for (const observer of this.observers) observer(notification)
    })
    this.unlistenClosed = await listen<{ error?: string | null }>('deepseek-harness://closed', event => {
      this.signature = ''
      this.starting = undefined
      this.failActive(new Error(event.payload?.error || 'DeepSeek Harness 已关闭。'))
    })
  }

  async start(options: { cwd: string; ai: AiConfig; permissionMode?: AgentPermissionMode }) {
    const signature = JSON.stringify({
      cwd: options.cwd,
      model: options.ai.model,
      baseURL: options.ai.baseURL,
      apiKey: options.ai.apiKey,
      customHeaders: options.ai.customHeaders,
      contextWindow: options.ai.contextWindow,
      maxTokens: options.ai.maxTokens,
      permissionMode: options.permissionMode,
    })
    if (this.signature === signature && this.starting) return this.starting
    this.signature = signature
    this.starting = (async () => {
      await this.ensureListener()
      await invoke('start_deepseek_harness', {
        cwd: options.cwd,
        model: options.ai.model,
        baseUrl: options.ai.baseURL,
        apiKey: options.ai.apiKey,
        customHeaders: options.ai.customHeaders,
        contextWindow: options.ai.contextWindow,
        maxTokens: options.ai.maxTokens,
        permissionMode: options.permissionMode || 'ask',
      })
    })().catch(error => {
      this.signature = ''
      this.starting = undefined
      throw error
    })
    return this.starting
  }

  async run(
    sessionId: string,
    input: string,
    options?: {
      onNotification?: Observer
      onRequest?: (request: HarnessWireNotification) => Promise<unknown>
    },
  ): Promise<HarnessRunResult> {
    const queue = new NotificationQueue()
    const observer: Observer = notification => {
      if (notification.id !== undefined) {
        void Promise.resolve(options?.onRequest?.(notification))
          .then(result => invoke('respond_deepseek_harness', {
            id: notification.id,
            result: result ?? null,
            error: null,
          }))
          .catch(error => invoke('respond_deepseek_harness', {
            id: notification.id,
            result: null,
            error: {
              code: -32000,
              message: error instanceof Error ? error.message : String(error),
            },
          }))
          .catch(() => {})
        return
      }
      const relatedSession = notification.params.sessionId
      if (relatedSession === sessionId || notification.method.startsWith('subagent.')) {
        queue.push(notification)
      }
    }
    this.observers.add(observer)
    this.activeQueues.add(queue)
    const events: HarnessWireEvent[] = []
    const notifications: HarnessWireNotification[] = []
    try {
      const receipt = await invoke<{ messageId: string }>('request_deepseek_harness', {
        method: 'session/prompt',
        params: { sessionId, contentBlocks: [{ type: 'text', text: input }] },
        timeoutMs: 60_000,
      })
      let received = false
      for (;;) {
        const notification = await queue.next()
        const rawEvent = notification.method === 'session.event' ? notification.params.event : undefined
        if (!received) {
          if (!isReceipt(rawEvent, receipt.messageId)) continue
          received = true
        }
        notifications.push(notification)
        options?.onNotification?.(notification)
        if (isRecord(rawEvent) && typeof rawEvent.type === 'string') {
          events.push(rawEvent as unknown as HarnessWireEvent)
        }
        if (
          notification.method === 'session.status'
          && notification.params.sessionId === sessionId
          && notification.params.status === 'idle'
        ) break
      }
    } finally {
      this.observers.delete(observer)
      this.activeQueues.delete(queue)
    }
    return {
      sessionId,
      finalResponse: [...events].reverse().map(assistantText).find(Boolean) || '',
      events,
      notifications,
    }
  }

  async followup(sessionId: string, input: string) {
    return invoke<{ messageId: string }>('request_deepseek_harness', {
      method: 'session/prompt',
      params: { sessionId, contentBlocks: [{ type: 'text', text: input }] },
      timeoutMs: 60_000,
    })
  }

  async stop() {
    this.signature = ''
    this.starting = undefined
    this.failActive(new Error('DeepSeek Harness 已停止。'))
    await invoke('stop_deepseek_harness')
  }
}

export const deepSeekHarnessClient = new NoteGoalHarnessClient()
