export type KernelPhase = 'idle' | 'running' | 'completed' | 'stopped' | 'error'
export type KernelInboxTarget = 'next-turn' | 'next-step'
export type KernelEndReason = 'completed' | 'stopped' | 'error' | 'steered' | 'cancelled'

export interface KernelEvent<T = unknown> {
  seq: number
  runId: string
  type: KernelEventType
  timestamp: number
  turn?: number
  step?: number
  data: T
}

export type KernelEventType =
  | 'session/start'
  | 'session/end'
  | 'turn/start'
  | 'turn/end'
  | 'step/start'
  | 'step/end'
  | 'user/message'
  | 'inbox/inserted'
  | 'inbox/claimed'
  | 'inbox/discarded'
  | 'assistant/chunk'
  | 'assistant/message'
  | 'tool/call'
  | 'tool/result'

export interface KernelPosition {
  turn: number
  step: number
}

export interface KernelInboxEntry<T> {
  id: number
  target: KernelInboxTarget
  value: T
}
