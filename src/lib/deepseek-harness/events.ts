/**
 * Append-only Agent session events, adapted from DeepSeek Harness' durable
 * session-event architecture.  These events are deliberately independent of
 * React so the same log can drive the sidebar, persistence and future plugins.
 */
export type HarnessEventKind =
  | 'session/start'
  | 'turn/start'
  | 'user/message'
  | 'run/start'
  | 'run/status'
  | 'trace/event'
  | 'tool/call'
  | 'tool/result'
  | 'step/complete'
  | 'assistant/message'
  | 'run/end'
  | 'run/error'
  | 'run/stopped'

export interface HarnessSessionEvent<T = unknown> {
  id: string
  sequence: number
  sessionId: string
  runId?: string
  kind: HarnessEventKind
  timestamp: number
  data: T
}

export type HarnessEventInput<T = unknown> = Omit<
  HarnessSessionEvent<T>,
  'id' | 'sequence' | 'timestamp'
> & {
  id?: string
  timestamp?: number
}

function eventId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `harness-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function appendHarnessEvent<T>(
  events: HarnessSessionEvent[],
  input: HarnessEventInput<T>,
): HarnessSessionEvent[] {
  return [
    ...events,
    {
      ...input,
      id: input.id || eventId(),
      sequence: events.length ? events[events.length - 1].sequence + 1 : 1,
      timestamp: input.timestamp || Date.now(),
    },
  ]
}

export function harnessSessionId(conversationId?: number, activeChatId?: number) {
  if (typeof conversationId === 'number') return `conversation:${conversationId}`
  if (typeof activeChatId === 'number') return `chat:${activeChatId}`
  return `temporary:${Date.now()}`
}

/** Restore the newest cumulative log persisted with a conversation message. */
export function restoreHarnessEvents(
  histories: Array<string | null | undefined>,
): HarnessSessionEvent[] {
  for (let index = histories.length - 1; index >= 0; index -= 1) {
    const history = histories[index]
    if (!history) continue
    try {
      const value = JSON.parse(history) as { harnessEvents?: unknown }
      if (!Array.isArray(value.harnessEvents)) continue
      const events = value.harnessEvents.filter((event): event is HarnessSessionEvent => (
        Boolean(event)
        && typeof event === 'object'
        && typeof (event as HarnessSessionEvent).id === 'string'
        && typeof (event as HarnessSessionEvent).sequence === 'number'
        && typeof (event as HarnessSessionEvent).kind === 'string'
      ))
      if (events.length) return events
    } catch {
      // Older messages may contain legacy or malformed history; try the prior one.
    }
  }
  return []
}
