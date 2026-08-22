import { Store } from '@tauri-apps/plugin-store'

import type { ResolvedSyncMapping } from './connector-mappings'
import { getSyncMetadataKey } from './sync-context'

const SYNC_BASELINES_KEY = 'syncBaselines'
let baselineUpdateQueue: Promise<void> = Promise.resolve()

export interface SyncBaseline {
  lastLocalContentSha?: string
  lastRemoteRevision?: string
  remoteExists: boolean
  updatedAt: number
}

export async function getSyncBaseline(
  localPath: string,
  mapping: ResolvedSyncMapping,
): Promise<SyncBaseline | null> {
  await baselineUpdateQueue
  const store = await Store.load('store.json')
  const baselines = await store.get<Record<string, SyncBaseline>>(SYNC_BASELINES_KEY) || {}
  return baselines[await getSyncMetadataKey(localPath, mapping)] || null
}

export async function setSyncBaseline(
  localPath: string,
  mapping: ResolvedSyncMapping,
  baseline: Omit<SyncBaseline, 'updatedAt'>,
): Promise<void> {
  const update = async () => {
    const store = await Store.load('store.json')
    const baselines = await store.get<Record<string, SyncBaseline>>(SYNC_BASELINES_KEY) || {}
    baselines[await getSyncMetadataKey(localPath, mapping)] = {
      ...baseline,
      updatedAt: Date.now(),
    }
    await store.set(SYNC_BASELINES_KEY, baselines)
    await store.save()
  }
  baselineUpdateQueue = baselineUpdateQueue.then(update, update)
  await baselineUpdateQueue
}
