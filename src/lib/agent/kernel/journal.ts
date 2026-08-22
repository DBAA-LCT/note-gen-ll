import type { KernelEndReason, KernelEvent, KernelEventType, KernelPhase } from './types'

export type KernelEventSink = (event: KernelEvent) => void

/** Append-only journal with idempotent lifecycle convergence. */
export class KernelJournal {
  private sequence = 0
  private readonly entries: KernelEvent[] = []
  private activeTurn = 0
  private lastTurn = 0
  private activeStep = 0
  private sessionOpen = false
  private phaseValue: KernelPhase = 'idle'

  constructor(
    readonly runId: string,
    private readonly sink?: KernelEventSink,
  ) {}

  get phase(): KernelPhase { return this.phaseValue }
  get turn(): number { return this.activeTurn }
  get step(): number { return this.activeStep }
  all(): readonly KernelEvent[] { return this.entries }

  append<T>(type: KernelEventType, data: T, position: Partial<{ turn: number; step: number }> = {}): KernelEvent<T> {
    const event: KernelEvent<T> = {
      seq: ++this.sequence,
      runId: this.runId,
      type,
      timestamp: Date.now(),
      ...(position.turn === undefined ? {} : { turn: position.turn }),
      ...(position.step === undefined ? {} : { step: position.step }),
      data,
    }
    this.entries.push(event)
    this.sink?.(event)
    return event
  }

  start(data: unknown = {}): void {
    if (this.sessionOpen) return
    this.sessionOpen = true
    this.phaseValue = 'running'
    this.append('session/start', data)
  }

  beginTurn(data: unknown = {}): number {
    this.start()
    if (this.activeTurn > 0) return this.activeTurn
    this.activeTurn = ++this.lastTurn
    this.append('turn/start', data, { turn: this.activeTurn })
    return this.activeTurn
  }

  beginStep(data: unknown = {}): { turn: number; step: number } {
    const turn = this.beginTurn()
    if (this.activeStep > 0) return { turn, step: this.activeStep }
    this.activeStep = this.lastStepForTurn() + 1
    this.append('step/start', data, { turn, step: this.activeStep })
    return { turn, step: this.activeStep }
  }

  endStep(reason: KernelEndReason = 'completed', data: unknown = {}): void {
    if (this.activeStep === 0) return
    const step = this.activeStep
    this.append('step/end', { ...this.asRecord(data), reason }, { turn: this.activeTurn, step })
    this.activeStep = 0
  }

  endTurn(reason: KernelEndReason = 'completed', data: unknown = {}): void {
    if (this.activeTurn === 0) return
    this.endStep(reason)
    const turn = this.activeTurn
    this.append('turn/end', { ...this.asRecord(data), reason }, { turn })
    this.activeTurn = 0
  }

  finish(reason: KernelEndReason = 'completed', data: unknown = {}): void {
    if (!this.sessionOpen) return
    this.endTurn(reason)
    this.append('session/end', { ...this.asRecord(data), reason })
    this.sessionOpen = false
    this.phaseValue = reason === 'stopped' || reason === 'cancelled'
      ? 'stopped'
      : reason === 'error' ? 'error' : 'completed'
  }

  private lastStepForTurn(): number {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const event = this.entries[index]
      if (event.turn === this.activeTurn && event.type === 'step/start') return event.step || 0
    }
    return 0
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
  }
}
