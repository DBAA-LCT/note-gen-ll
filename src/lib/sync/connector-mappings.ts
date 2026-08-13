import { Store } from '@tauri-apps/plugin-store'

import { RepoNames } from './github.types'
import { getWorkspaceSyncConfig } from './workspace-sync-config'
import { getWorkspaceSyncRepos } from './workspace-repos'
import type { SyncPlatform } from '@/types/sync'
import emitter from '@/lib/emitter'

export type SyncMappingEntryType = 'directory' | 'file'
export type SyncMappingAccessMode = 'read-write' | 'read-only'
export type SyncMappingMode = 'automatic' | 'manual'
export type SyncPathPolicy = 'local-only' | 'pull-only' | 'sync' | 'ignore-remote'

export interface ConnectorSyncMapping {
  id: string
  platform: SyncPlatform
  localWorkspacePath: string
  localPath: string
  remoteTarget: string
  remotePath: string
  excludedPaths: string[]
  pathPolicies: Record<string, SyncPathPolicy>
  entryType: SyncMappingEntryType
  accessMode: SyncMappingAccessMode
  syncMode: SyncMappingMode
  autoPullOnOpen: boolean
  enabled: boolean
}

export interface ResolvedSyncMapping extends ConnectorSyncMapping {
  remoteFilePath: string
  syncPolicy: SyncPathPolicy
}

type ConnectorMappingMap = Partial<Record<SyncPlatform, ConnectorSyncMapping[]>>

const CONNECTOR_MAPPINGS_KEY = 'syncConnectorMappings'
const CONNECTOR_MAPPINGS_MIGRATED_KEY = 'syncConnectorMappingsMigrated'
let updateQueue: Promise<void> = Promise.resolve()

function normalizePath(value: string) {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
}

function normalizeWorkspacePath(value: string) {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

function createId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `mapping-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function normalizeMapping(mapping: ConnectorSyncMapping): ConnectorSyncMapping {
  const legacyExclusions = (mapping.excludedPaths || []).map(normalizePath).filter(Boolean)
  const pathPolicies = Object.fromEntries(
    Object.entries(mapping.pathPolicies || {})
      .map(([path, policy]) => [normalizePath(path), policy])
      .map(([path, policy]) => [path, policy === 'push-only' ? 'ignore-remote' : policy])
      .filter(([, policy]) => ['local-only', 'pull-only', 'sync', 'ignore-remote'].includes(policy)),
  ) as Record<string, SyncPathPolicy>
  for (const path of legacyExclusions) pathPolicies[path] ||= 'local-only'
  return {
    ...mapping,
    id: mapping.id || createId(),
    localWorkspacePath: normalizeWorkspacePath(mapping.localWorkspacePath || ''),
    localPath: normalizePath(mapping.localPath || ''),
    remoteTarget: mapping.remoteTarget?.trim() || '',
    remotePath: normalizePath(mapping.remotePath || ''),
    excludedPaths: legacyExclusions,
    pathPolicies,
    entryType: mapping.entryType || 'directory',
    accessMode: mapping.accessMode || 'read-write',
    syncMode: mapping.syncMode || 'manual',
    autoPullOnOpen: mapping.autoPullOnOpen ?? true,
    // Mapping activation is no longer a separate user-facing state. Whether a
    // resource participates is controlled exclusively by its path policy.
    enabled: true,
  }
}

function joinRemotePath(root: string, suffix: string) {
  return [normalizePath(root), normalizePath(suffix)].filter(Boolean).join('/')
}

async function getLegacyRemoteTarget(
  store: Store,
  platform: SyncPlatform,
  workspacePath: string,
) {
  if (platform === 'github' || platform === 'gitee' || platform === 'gitlab' || platform === 'gitea') {
    const repos = await getWorkspaceSyncRepos(workspacePath)
    return repos[platform]?.trim() || (workspacePath ? '' : RepoNames.sync)
  }
  if (platform === 's3') return (await store.get<{ bucket?: string }>('s3SyncConfig'))?.bucket || ''
  if (platform === 'webdav') return (await store.get<{ url?: string }>('webdavSyncConfig'))?.url || ''
  return (await store.get<{ path?: string }>('cloudFolderSyncConfig'))?.path || ''
}

async function migrateLegacyMappings(store: Store): Promise<ConnectorMappingMap> {
  const currentWorkspace = await store.get<string>('workspacePath') || ''
  const history = await store.get<string[]>('workspaceHistory') || []
  const workspaces = Array.from(new Set([currentWorkspace, ...history, '']))
  const result: ConnectorMappingMap = {}

  for (const workspacePath of workspaces) {
    const config = await getWorkspaceSyncConfig(workspacePath)
    const remoteTarget = await getLegacyRemoteTarget(store, config.platform, workspacePath)
    if (!remoteTarget) continue

    const mapping: ConnectorSyncMapping = normalizeMapping({
      id: createId(),
      platform: config.platform,
      localWorkspacePath: workspacePath,
      localPath: '',
      remoteTarget,
      remotePath: '',
      excludedPaths: [],
      pathPolicies: {},
      entryType: 'directory',
      accessMode: config.accessMode,
      syncMode: config.autoSync === 'disabled' ? 'manual' : 'automatic',
      autoPullOnOpen: config.autoPullOnOpen,
      enabled: true,
    })
    result[config.platform] = [...(result[config.platform] || []), mapping]
  }

  await store.set(CONNECTOR_MAPPINGS_KEY, result)
  await store.set(CONNECTOR_MAPPINGS_MIGRATED_KEY, true)
  await store.save()
  return result
}

async function readMappingMap(store: Store): Promise<ConnectorMappingMap> {
  const saved = await store.get<ConnectorMappingMap>(CONNECTOR_MAPPINGS_KEY)
  const migrated = await store.get<boolean>(CONNECTOR_MAPPINGS_MIGRATED_KEY)
  const mappings = saved || (migrated ? {} : await migrateLegacyMappings(store))
  return Object.fromEntries(
    Object.entries(mappings).map(([platform, items]) => [
      platform,
      (items || []).map(item => normalizeMapping(item)),
    ]),
  ) as ConnectorMappingMap
}

export async function getConnectorMappings(platform?: SyncPlatform): Promise<ConnectorSyncMapping[]> {
  await updateQueue
  const store = await Store.load('store.json')
  const map = await readMappingMap(store)
  if (platform) return map[platform] || []
  return Object.values(map).flatMap(items => items || [])
}

export async function saveConnectorMapping(
  mapping: Omit<ConnectorSyncMapping, 'id'> & { id?: string },
): Promise<ConnectorSyncMapping> {
  let saved!: ConnectorSyncMapping
  const update = async () => {
    const store = await Store.load('store.json')
    const map = await readMappingMap(store)
    saved = normalizeMapping({ ...mapping, id: mapping.id || createId() })
    const existing = map[saved.platform] || []
    const index = existing.findIndex(item => item.id === saved.id)
    const next = [...existing]
    if (index >= 0) next[index] = saved
    else next.push(saved)
    await store.set(CONNECTOR_MAPPINGS_KEY, { ...map, [saved.platform]: next })
    await store.set(CONNECTOR_MAPPINGS_MIGRATED_KEY, true)
    await store.save()
  }
  updateQueue = updateQueue.then(update, update)
  await updateQueue
  emitter.emit('sync-mappings-changed')
  return saved
}

export async function deleteConnectorMapping(platform: SyncPlatform, id: string): Promise<void> {
  const update = async () => {
    const store = await Store.load('store.json')
    const map = await readMappingMap(store)
    await store.set(CONNECTOR_MAPPINGS_KEY, {
      ...map,
      [platform]: (map[platform] || []).filter(item => item.id !== id),
    })
    await store.set(CONNECTOR_MAPPINGS_MIGRATED_KEY, true)
    await store.save()
  }
  updateQueue = updateQueue.then(update, update)
  await updateQueue
  emitter.emit('sync-mappings-changed')
}

export async function resolveSyncMappings(
  localPath: string,
  workspacePath?: string,
): Promise<ResolvedSyncMapping[]> {
  const store = await Store.load('store.json')
  const targetWorkspace = normalizeWorkspacePath(
    workspacePath ?? await store.get<string>('workspacePath') ?? '',
  )
  const targetPath = normalizePath(localPath)
  const mappings = (await getConnectorMappings()).filter((mapping) => {
    if (!mapping.enabled || mapping.localWorkspacePath !== targetWorkspace) return false
    const policy = getEffectiveSyncPathPolicy(mapping, targetPath)
    if (policy === 'local-only' || policy === 'ignore-remote') return false
    if (mapping.entryType === 'file') return targetPath === mapping.localPath
    return !mapping.localPath
      || targetPath === mapping.localPath
      || targetPath.startsWith(`${mapping.localPath}/`)
  })

  if (!mappings.length) return []
  const maxSpecificity = Math.max(...mappings.map(item => item.localPath.length))
  return mappings
    .filter(item => item.localPath.length === maxSpecificity)
    .map((mapping) => {
      const suffix = mapping.entryType === 'file'
        ? ''
        : targetPath.slice(mapping.localPath.length).replace(/^\/+/, '')
      return {
        ...mapping,
        accessMode: getEffectiveSyncPathPolicy(mapping, targetPath) === 'pull-only' ? 'read-only' : 'read-write',
        syncPolicy: getEffectiveSyncPathPolicy(mapping, targetPath),
        remoteFilePath: mapping.entryType === 'file'
          ? mapping.remotePath || targetPath.split('/').pop() || targetPath
          : joinRemotePath(mapping.remotePath, suffix),
      }
    })
}

export function getEffectiveSyncPathPolicy(
  mapping: ConnectorSyncMapping,
  localPath: string,
): SyncPathPolicy {
  const path = normalizePath(localPath)
  const matchingOverride = Object.entries(mapping.pathPolicies || {})
    .filter(([overridePath]) => !overridePath || path === overridePath || path.startsWith(`${overridePath}/`))
    .sort(([left], [right]) => right.length - left.length)[0]
  if (matchingOverride) return matchingOverride[1]
  if ((mapping.excludedPaths || []).some(excluded => path === excluded || path.startsWith(`${excluded}/`))) {
    return 'local-only'
  }
  return mapping.accessMode === 'read-only' ? 'pull-only' : 'sync'
}

export async function resolvePrimarySyncMapping(
  localPath: string,
  workspacePath?: string,
): Promise<ResolvedSyncMapping | undefined> {
  return (await resolveSyncMappings(localPath, workspacePath))[0]
}

export interface SyncPathWritePolicy {
  configured: boolean
  writable: boolean
  blockedByReadOnly: boolean
  ambiguous: boolean
}

/**
 * Resolve whether a generic remote write is safe for a local path.
 * Folder operations also inspect descendant mappings, because deleting a
 * writable parent must never erase content protected by a read-only child.
 */
export async function getSyncPathWritePolicy(
  localPath: string,
  options: { workspacePath?: string; includeDescendants?: boolean } = {},
): Promise<SyncPathWritePolicy> {
  const store = await Store.load('store.json')
  const workspacePath = normalizeWorkspacePath(
    options.workspacePath ?? await store.get<string>('workspacePath') ?? '',
  )
  const path = normalizePath(localPath)

  if (!options.includeDescendants) {
    const mappings = await resolveSyncMappings(path, workspacePath)
    const blockedByReadOnly = mappings.some(mapping => mapping.syncPolicy === 'pull-only')
    return {
      configured: mappings.length > 0,
      writable: mappings.length === 1 && mappings[0].syncPolicy === 'sync',
      blockedByReadOnly,
      ambiguous: mappings.length > 1,
    }
  }

  const mappings = (await getConnectorMappings()).filter((mapping) => {
    if (!mapping.enabled || mapping.localWorkspacePath !== workspacePath) return false
    const mappingPath = normalizePath(mapping.localPath)
    if (!path || !mappingPath) return true
    return mappingPath === path
      || mappingPath.startsWith(`${path}/`)
      || path.startsWith(`${mappingPath}/`)
  })
  const policies = mappings.map(mapping => getEffectiveSyncPathPolicy(mapping, path))
  const blockedByReadOnly = policies.some(policy => policy === 'pull-only')
  return {
    configured: mappings.length > 0,
    writable: mappings.length === 1 && policies[0] === 'sync',
    blockedByReadOnly,
    ambiguous: mappings.length > 1,
  }
}
