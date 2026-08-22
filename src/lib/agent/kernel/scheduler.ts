export type ToolExecutionMode = 'parallel' | 'exclusive'

export interface ScheduledToolCall<T> {
  id: string
  name: string
  mode: ToolExecutionMode | (() => ToolExecutionMode)
  run: (signal: AbortSignal) => Promise<T>
}

export type ScheduledToolResult<T> =
  | { kind: 'completed'; call: ScheduledToolCall<T>; value: T }
  | { kind: 'cancelled'; call: ScheduledToolCall<T>; reason: unknown }

export interface ToolSchedulerObserver<T> {
  started?: (call: ScheduledToolCall<T>) => void
  committed?: (result: ScheduledToolResult<T>) => void
}

/**
 * Semantic port of the repository's DeepSeek Harness agent-loop scheduler.
 * Only tool bodies overlap; commits stay in model order and exclusive calls form barriers.
 */
export class DshToolScheduler {
  private readonly parallelLimit: number

  constructor(maxParallel = 4) {
    this.parallelLimit = Math.max(1, Math.floor(maxParallel))
  }

  async execute<T>(
    calls: ScheduledToolCall<T>[],
    signal: AbortSignal,
    observer: ToolSchedulerObserver<T> = {},
  ): Promise<ScheduledToolResult<T>[]> {
    const committed: ScheduledToolResult<T>[] = []
    let next = 0
    while (next < calls.length) {
      const first = calls[next]
      const mode = this.mode(first)
      const group = mode === 'exclusive' ? [first] : calls.slice(next)
      const outcome = await this.runGroup(group, mode, signal, observer)
      committed.push(...outcome.results)
      next += outcome.consumed
      if (signal.aborted) {
        for (const call of calls.slice(next)) {
          const result: ScheduledToolResult<T> = { kind: 'cancelled', call, reason: signal.reason }
          committed.push(result)
          observer.committed?.(result)
        }
        break
      }
    }
    return committed
  }

  private mode<T>(call: ScheduledToolCall<T>): ToolExecutionMode {
    return typeof call.mode === 'function' ? call.mode() : call.mode
  }

  private async runGroup<T>(
    group: ScheduledToolCall<T>[],
    groupMode: ToolExecutionMode,
    signal: AbortSignal,
    observer: ToolSchedulerObserver<T>,
  ): Promise<{ results: ScheduledToolResult<T>[]; consumed: number }> {
    const slots: Array<ScheduledToolResult<T> | undefined> = new Array(group.length)
    const inFlight = new Map<number, Promise<number>>()
    let nextToStart = 0
    let nextToCommit = 0

    const commitReady = () => {
      const ready: ScheduledToolResult<T>[] = []
      while (nextToCommit < slots.length && slots[nextToCommit]) {
        const result = slots[nextToCommit] as ScheduledToolResult<T>
        ready.push(result)
        observer.committed?.(result)
        nextToCommit += 1
      }
      return ready
    }

    const start = (index: number) => {
      const call = group[index]
      observer.started?.(call)
      const pending = Promise.resolve()
        .then(() => call.run(signal))
        .then(
        value => {
          slots[index] = { kind: 'completed', call, value }
          return index
        },
        error => {
          if (signal.aborted) {
            slots[index] = { kind: 'cancelled', call, reason: signal.reason ?? error }
            return index
          }
          throw { index, error }
        },
      )
      inFlight.set(index, pending)
    }

    const fill = () => {
      while (!signal.aborted && nextToStart < group.length && inFlight.size < this.parallelLimit) {
        if (nextToStart > 0 && groupMode === 'parallel' && this.mode(group[nextToStart]) !== 'parallel') break
        start(nextToStart++)
      }
    }

    fill()
    const ordered: ScheduledToolResult<T>[] = []
    try {
      while (inFlight.size > 0) {
        const index = await Promise.race(inFlight.values())
        inFlight.delete(index)
        ordered.push(...commitReady())
        fill()
      }
    } catch (failure) {
      await Promise.allSettled(inFlight.values())
      const error = failure && typeof failure === 'object' && 'error' in failure
        ? (failure as { error: unknown }).error
        : failure
      throw error
    }

    if (signal.aborted) {
      for (let index = nextToStart; index < group.length; index += 1) {
        slots[index] = { kind: 'cancelled', call: group[index], reason: signal.reason }
      }
      ordered.push(...commitReady())
      return { results: ordered, consumed: group.length }
    }
    return { results: ordered, consumed: nextToStart }
  }
}
