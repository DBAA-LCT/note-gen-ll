import { KernelInbox } from './inbox'
import { KernelJournal, type KernelEventSink } from './journal'
import { DshToolScheduler, type ScheduledToolCall, type ScheduledToolResult } from './scheduler'
import type { KernelEndReason, KernelEvent, KernelInboxEntry, KernelInboxTarget, KernelPhase } from './types'

/**
 * In-process lifecycle kernel. Its algorithm is a semantic TypeScript port of
 * the repository's DeepSeek Harness agent-loop; it does not call the sidecar.
 */
export class EmbeddedAgentKernel<TInbox = unknown> {
  readonly journal: KernelJournal
  readonly inbox: KernelInbox<TInbox>
  readonly tools: DshToolScheduler
  private readonly activityAbort = new AbortController()
  private steeringWakeRequested = false

  constructor(runId: string, sink?: KernelEventSink, maxParallelToolCalls = 4) {
    this.journal = new KernelJournal(runId, sink)
    this.tools = new DshToolScheduler(maxParallelToolCalls)
    this.inbox = new KernelInbox<TInbox>({
      inserted: entry => this.recordInbox('inbox/inserted', entry),
      claimed: (entry, turn) => this.recordInbox('inbox/claimed', entry, turn),
      discarded: entry => this.recordInbox('inbox/discarded', entry),
    })
  }

  get runId(): string { return this.journal.runId }
  get phase(): KernelPhase { return this.journal.phase }
  get signal(): AbortSignal { return this.activityAbort.signal }
  get steeringRequested(): boolean { return this.steeringWakeRequested || this.inbox.nextStep.length > 0 }

  start(initial?: unknown): void {
    this.journal.start(initial)
  }

  beginTurn(data: unknown = {}): number {
    return this.journal.beginTurn(data)
  }

  beginStep(data: unknown = {}): { turn: number; step: number } {
    return this.journal.beginStep(data)
  }

  endStep(reason: KernelEndReason = 'completed', data: unknown = {}): void {
    this.journal.endStep(reason, data)
  }

  finish(reason: KernelEndReason = 'completed', data: unknown = {}): void {
    this.journal.finish(reason, data)
  }

  followup(value: TInbox): void {
    this.inbox.send('next-turn', value)
  }

  markSteeringRequested(): void {
    this.steeringWakeRequested = true
  }

  steer(value: TInbox): void {
    this.steeringWakeRequested = true
    this.inbox.send('next-step', value)
  }

  claim(target: KernelInboxTarget): TInbox[] {
    const values = this.inbox.claim(target, this.journal.turn)
    if (target === 'next-step') this.steeringWakeRequested = false
    return values
  }

  cancel(reason: unknown = { kind: 'cancelled' }, keepInbox = false): void {
    if (!keepInbox) this.inbox.clear()
    this.steeringWakeRequested = false
    if (!this.activityAbort.signal.aborted) this.activityAbort.abort(reason)
  }

  recordUserMessage(data: unknown): void {
    this.record('user/message', data)
  }

  recordAssistantChunk(data: unknown): void {
    this.record('assistant/chunk', data)
  }

  recordAssistantMessage(data: unknown): void {
    this.record('assistant/message', data)
  }

  recordToolCall(data: unknown): void {
    this.record('tool/call', data)
  }

  recordToolResult(data: unknown): void {
    this.record('tool/result', data)
  }

  executeTools<T>(calls: ScheduledToolCall<T>[]): Promise<ScheduledToolResult<T>[]> {
    return this.tools.execute(calls, this.signal)
  }

  events(): readonly KernelEvent[] {
    return this.journal.all()
  }

  private record(type: 'user/message' | 'assistant/chunk' | 'assistant/message' | 'tool/call' | 'tool/result', data: unknown): void {
    this.journal.append(type, data, {
      ...(this.journal.turn > 0 ? { turn: this.journal.turn } : {}),
      ...(this.journal.step > 0 ? { step: this.journal.step } : {}),
    })
  }

  private recordInbox(
    type: 'inbox/inserted' | 'inbox/claimed' | 'inbox/discarded',
    entry: KernelInboxEntry<TInbox>,
    turn = this.journal.turn,
  ): void {
    this.journal.append(type, { id: entry.id, target: entry.target }, turn > 0 ? { turn } : {})
  }
}
