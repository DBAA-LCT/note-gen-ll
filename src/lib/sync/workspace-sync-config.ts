import { Store } from '@tauri-apps/plugin-store'

import type { CloudFolderConfig, S3Config, SyncPlatform, WebDAVConfig } from '@/types/sync'

export interface WorkspaceSyncConfig {
  platform: SyncPlatform
  accessMode: 'read-write' | 'read-only'
  autoSync: string
  autoPullOnOpen: boolean
  excludePatterns: string[]
  s3Config?: S3Config
  webdavConfig?: WebDAVConfig
  cloudFolderConfig?: CloudFolderConfig
}

type WorkspaceSyncConfigMap = Record<string, WorkspaceSyncConfig>

const WORKSPACE_SYNC_CONFIGS_KEY = 'workspaceSyncConfigs'
const DEFAULT_WORKSPACE_KEY = '__default__'
const DEFAULT_EXCLUDE_PATTERNS = ['.notegen/', '*.tmp', '*.bak', '*.swp', 'Thumbs.db', '.DS_Store', '*.lock']

let updateQueue: Promise<void> = Promise.resolve()
let activeWorkspaceSyncAccessMode: WorkspaceSyncConfig['accessMode'] = 'read-write'

export function getWorkspaceSyncKey(workspacePath: string): string {
  const normalizedPath = workspacePath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return normalizedPath || DEFAULT_WORKSPACE_KEY
}

async function readLegacyConfig(store: Store): Promise<WorkspaceSyncConfig> {
  return {
    platform: await store.get<SyncPlatform>('primaryBackupMethod') || 'github',
    accessMode: await store.get<'read-write' | 'read-only'>('syncAccessMode') || 'read-write',
    autoSync: await store.get<string>('autoSync') || 'disabled',
    autoPullOnOpen: await store.get<boolean>('autoPullOnOpen') ?? true,
    excludePatterns: await store.get<string[]>('syncExcludePatterns') || DEFAULT_EXCLUDE_PATTERNS,
    s3Config: await store.get<S3Config>('s3SyncConfig') || undefined,
    webdavConfig: await store.get<WebDAVConfig>('webdavSyncConfig') || undefined,
    cloudFolderConfig: await store.get<CloudFolderConfig>('cloudFolderSyncConfig') || undefined,
  }
}

function normalizeConfig(config: WorkspaceSyncConfig): WorkspaceSyncConfig {
  const excludePatterns = Array.isArray(config.excludePatterns)
    ? config.excludePatterns
    : DEFAULT_EXCLUDE_PATTERNS
  return {
    ...config,
    platform: config.platform || 'github',
    accessMode: config.accessMode || 'read-write',
    autoSync: config.autoSync || 'disabled',
    autoPullOnOpen: config.autoPullOnOpen ?? true,
    excludePatterns: Array.from(new Set(
      excludePatterns
        .map(pattern => pattern.trim().replace(/\\/g, '/'))
        .filter(Boolean),
    )),
  }
}

async function writeActiveMirror(store: Store, config: WorkspaceSyncConfig) {
  activeWorkspaceSyncAccessMode = config.accessMode
  await store.set('primaryBackupMethod', config.platform)
  await store.set('syncAccessMode', config.accessMode)
  await store.set('autoSync', config.autoSync)
  await store.set('autoPullOnOpen', config.autoPullOnOpen)
  await store.set('syncExcludePatterns', config.excludePatterns)
}

export async function getWorkspaceSyncConfig(workspacePath?: string): Promise<WorkspaceSyncConfig> {
  await updateQueue
  const store = await Store.load('store.json')
  const targetPath = workspacePath ?? await store.get<string>('workspacePath') ?? ''
  const configs = await store.get<WorkspaceSyncConfigMap>(WORKSPACE_SYNC_CONFIGS_KEY) || {}
  const saved = configs[getWorkspaceSyncKey(targetPath)]
  const config = normalizeConfig(saved || await readLegacyConfig(store))
  const activePath = await store.get<string>('workspacePath') || ''
  if (getWorkspaceSyncKey(activePath) === getWorkspaceSyncKey(targetPath)) {
    activeWorkspaceSyncAccessMode = config.accessMode
  }
  return config
}

export async function updateWorkspaceSyncConfig(
  patch: Partial<WorkspaceSyncConfig>,
  workspacePath?: string,
): Promise<WorkspaceSyncConfig> {
  await updateQueue
  let result: WorkspaceSyncConfig | undefined

  const update = async () => {
    const store = await Store.load('store.json')
    const activePath = await store.get<string>('workspacePath') || ''
    const targetPath = workspacePath ?? activePath
    const targetKey = getWorkspaceSyncKey(targetPath)
    const configs = await store.get<WorkspaceSyncConfigMap>(WORKSPACE_SYNC_CONFIGS_KEY) || {}
    const current = normalizeConfig(configs[targetKey] || await readLegacyConfig(store))
    result = normalizeConfig({ ...current, ...patch })

    await store.set(WORKSPACE_SYNC_CONFIGS_KEY, { ...configs, [targetKey]: result })
    if (getWorkspaceSyncKey(activePath) === targetKey) await writeActiveMirror(store, result)
    await store.save()
  }

  updateQueue = updateQueue.then(update, update)
  await updateQueue
  return result!
}

export async function switchWorkspaceSyncConfig(
  previousWorkspacePath: string,
  nextWorkspacePath: string,
): Promise<WorkspaceSyncConfig> {
  await updateQueue
  let nextConfig: WorkspaceSyncConfig | undefined

  const update = async () => {
    const store = await Store.load('store.json')
    const configs = await store.get<WorkspaceSyncConfigMap>(WORKSPACE_SYNC_CONFIGS_KEY) || {}
    const previousKey = getWorkspaceSyncKey(previousWorkspacePath)
    const nextKey = getWorkspaceSyncKey(nextWorkspacePath)
    const previousConfig = normalizeConfig(configs[previousKey] || await readLegacyConfig(store))
    nextConfig = normalizeConfig(configs[nextKey] || previousConfig)

    await store.set(WORKSPACE_SYNC_CONFIGS_KEY, {
      ...configs,
      [previousKey]: previousConfig,
      [nextKey]: nextConfig,
    })
    await store.set('workspacePath', nextWorkspacePath)
    await writeActiveMirror(store, nextConfig)
    await store.save()
  }

  updateQueue = updateQueue.then(update, update)
  await updateQueue
  return nextConfig!
}

export async function saveWorkspaceProviderConfig(
  platform: 's3' | 'webdav' | 'cloudFolder',
  config: S3Config | WebDAVConfig | CloudFolderConfig,
) {
  const store = await Store.load('store.json')
  const key = platform === 's3'
    ? 's3SyncConfig'
    : platform === 'webdav'
      ? 'webdavSyncConfig'
      : 'cloudFolderSyncConfig'
  await store.set(key, config)
  await store.save()

  // Keep the legacy workspace field populated for downgrade compatibility only.
  if (platform === 's3') return updateWorkspaceSyncConfig({ s3Config: config as S3Config })
  if (platform === 'webdav') return updateWorkspaceSyncConfig({ webdavConfig: config as WebDAVConfig })
  return updateWorkspaceSyncConfig({ cloudFolderConfig: config as CloudFolderConfig })
}

export async function isCurrentWorkspaceSyncReadOnly(): Promise<boolean> {
  const store = await Store.load('store.json')
  return await store.get<string>('syncAccessMode') === 'read-only'
}

export function isActiveWorkspaceSyncReadOnly(): boolean {
  return activeWorkspaceSyncAccessMode === 'read-only'
}
