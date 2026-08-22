import type { KernelInboxEntry, KernelInboxTarget } from './types'

export interface KernelInboxObserver<T> {
  inserted?: (entry: KernelInboxEntry<T>) => void
  claimed?: (entry: KernelInboxEntry<T>, turn: number) => void
  discarded?: (entry: KernelInboxEntry<T>) => void
}

/** DSH-style two-boundary inbox, implemented without the Harness runtime. */
export class KernelInbox<T> {
  private id = 0
  private readonly queues: Record<KernelInboxTarget, KernelInboxEntry<T>[]> = {
    'next-turn': [],
    'next-step': [],
  }

  constructor(private readonly observer: KernelInboxObserver<T> = {}) {}

  get hasPending(): boolean {
    return this.queues['next-turn'].length > 0 || this.queues['next-step'].length > 0
  }

  get nextTurn(): readonly KernelInboxEntry<T>[] {
    return this.queues['next-turn']
  }

  get nextStep(): readonly KernelInboxEntry<T>[] {
    return this.queues['next-step']
  }

  send(target: KernelInboxTarget, value: T): KernelInboxEntry<T> {
    const entry = { id: ++this.id, target, value }
    this.queues[target].push(entry)
    this.observer.inserted?.(entry)
    return entry
  }

  claim(target: KernelInboxTarget, turn: number): T[] {
    const claimed = this.queues[target].splice(0)
    for (const entry of claimed) this.observer.claimed?.(entry, turn)
    return claimed.map(entry => entry.value)
  }

  clear(target?: KernelInboxTarget): void {
    const targets: KernelInboxTarget[] = target ? [target] : ['next-turn', 'next-step']
    for (const current of targets) {
      const discarded = this.queues[current].splice(0)
      for (const entry of discarded) this.observer.discarded?.(entry)
    }
  }
}
