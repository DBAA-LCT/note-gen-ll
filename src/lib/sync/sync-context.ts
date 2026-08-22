import { Store } from '@tauri-apps/plugin-store'

import { getOptionalSyncRepoName } from './repo-utils'
import { resolvePrimarySyncMapping } from './connector-mappings'
import type { CloudFolderConfig } from '@/types/sync'
import type { ResolvedSyncMapping } from './connector-mappings'

const GIT_SYNC_PROVIDERS = ['github', 'gitee', 'gitlab', 'gitea'] as const
type GitSyncProvider = typeof GIT_SYNC_PROVIDERS[number]

function normalizeWorkspacePath(path: string) {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

function isGitSyncProvider(provider: string): provider is GitSyncProvider {
  return GIT_SYNC_PROVIDERS.includes(provider as GitSyncProvider)
}

export async function getCurrentSyncContext(localPath = '') {
  const store = await Store.load('store.json')
  const workspacePath = normalizeWorkspacePath(await store.get<string>('workspacePath') || '')
  const mapping = await resolvePrimarySyncMapping(localPath, workspacePath)
  const provider = mapping?.platform || await store.get<string>('primaryBackupMethod') || 'github'
  const repo = mapping?.remoteTarget || (isGitSyncProvider(provider)
    ? await getOptionalSyncRepoName(provider, localPath)
    : provider === 'cloudFolder'
      ? (await store.get<CloudFolderConfig>('cloudFolderSyncConfig'))?.path || ''
      : '')

  return {
    workspacePath,
    workspaceKey: workspacePath || '__default__',
    provider,
    repo,
    mappingId: mapping?.id || '',
    remoteFilePath: mapping?.remoteFilePath || localPath,
    accessMode: mapping?.accessMode || 'read-write',
  }
}

export async function getSyncMetadataKey(
  path: string,
  selectedMapping?: ResolvedSyncMapping,
) {
  if (selectedMapping) {
    return JSON.stringify([
      normalizeWorkspacePath(selectedMapping.localWorkspacePath) || '__default__',
      selectedMapping.platform,
      selectedMapping.remoteTarget,
      selectedMapping.id,
      selectedMapping.remoteFilePath,
      path,
    ])
  }

  const context = await getCurrentSyncContext(path)
  return JSON.stringify([
    context.workspaceKey,
    context.provider,
    context.repo,
    context.mappingId,
    context.remoteFilePath,
    path,
  ])
}
