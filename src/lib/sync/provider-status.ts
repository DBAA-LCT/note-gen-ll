import { Store } from '@tauri-apps/plugin-store'

import { SyncStateEnum } from '@/lib/sync/github.types'
import { testS3Connection } from '@/lib/sync/s3'
import { testWebDAVConnection } from '@/lib/sync/webdav'
import { testCloudFolderConnection } from '@/lib/sync/cloud-folder'
import useSyncStore from '@/stores/sync'
import type { CloudFolderConfig, S3Config, SyncPlatform, WebDAVConfig } from '@/types/sync'

type GitSyncPlatform = 'github' | 'gitee' | 'gitlab' | 'gitea'

export async function testGitSyncProviderConnection(platform: GitSyncPlatform): Promise<boolean> {
  const syncStore = useSyncStore.getState()

  try {
    switch (platform) {
      case 'github': {
        const { getUserInfo } = await import('@/lib/sync/github')
        const response = await getUserInfo()
        if (!response || !response.data) return false
        syncStore.setUserInfo(response.data)
        return true
      }
      case 'gitee': {
        const { getUserInfo } = await import('@/lib/sync/gitee')
        const user = await getUserInfo()
        if (!user) return false
        syncStore.setGiteeUserInfo(user)
        return true
      }
      case 'gitlab': {
        const { getUserInfo } = await import('@/lib/sync/gitlab')
        const user = await getUserInfo()
        if (!user) return false
        syncStore.setGitlabUserInfo(user)
        return true
      }
      case 'gitea': {
        const { getUserInfo } = await import('@/lib/sync/gitea')
        const user = await getUserInfo()
        if (!user) return false
        syncStore.setGiteaUserInfo(user)
        return true
      }
    }
  } catch (error) {
    console.error(`Failed to test ${platform} connection:`, error)
    return false
  }
}

async function checkGithubStatus(store: Store) {
  const syncStore = useSyncStore.getState()
  const accessToken = await store.get<string>('accessToken')

  syncStore.setSyncRepoInfo(undefined)
  if (!accessToken) {
    syncStore.setSyncRepoState(SyncStateEnum.fail)
    return
  }

  syncStore.setSyncRepoState(SyncStateEnum.checking)
  try {
    const { getUserInfo } = await import('@/lib/sync/github')
    const userResponse = await getUserInfo()
    if (!userResponse || !('data' in userResponse) || !userResponse.data) {
      throw new Error('GitHub connection is unavailable')
    }
    syncStore.setUserInfo(userResponse.data)
    syncStore.setSyncRepoState(SyncStateEnum.success)
  } catch (error) {
    console.error('Failed to check GitHub status:', error)
    syncStore.setSyncRepoState(SyncStateEnum.fail)
  }
}

async function checkGiteeStatus(store: Store) {
  const syncStore = useSyncStore.getState()
  const accessToken = await store.get<string>('giteeAccessToken')
  syncStore.setGiteeSyncRepoInfo(undefined)
  if (!accessToken) {
    syncStore.setGiteeSyncRepoState(SyncStateEnum.fail)
    return
  }

  syncStore.setGiteeSyncRepoState(SyncStateEnum.checking)
  try {
    const { getUserInfo } = await import('@/lib/sync/gitee')
    const userInfo = await getUserInfo()
    if (!userInfo) throw new Error('Gitee connection is unavailable')
    syncStore.setGiteeUserInfo(userInfo)
    syncStore.setGiteeSyncRepoState(SyncStateEnum.success)
  } catch (error) {
    console.error('Failed to check Gitee status:', error)
    syncStore.setGiteeSyncRepoState(SyncStateEnum.fail)
  }
}

async function checkGitlabStatus(store: Store) {
  const syncStore = useSyncStore.getState()
  const accessToken = await store.get<string>('gitlabAccessToken')
  syncStore.setGitlabSyncProjectInfo(undefined)
  if (!accessToken) {
    syncStore.setGitlabSyncProjectState(SyncStateEnum.fail)
    return
  }

  syncStore.setGitlabSyncProjectState(SyncStateEnum.checking)
  try {
    const { getUserInfo } = await import('@/lib/sync/gitlab')
    const userInfo = await getUserInfo()
    if (!userInfo) throw new Error('GitLab connection is unavailable')
    syncStore.setGitlabUserInfo(userInfo)
    syncStore.setGitlabSyncProjectState(SyncStateEnum.success)
  } catch (error) {
    console.error('Failed to check GitLab status:', error)
    syncStore.setGitlabSyncProjectState(SyncStateEnum.fail)
  }
}

async function checkGiteaStatus(store: Store) {
  const syncStore = useSyncStore.getState()
  const accessToken = await store.get<string>('giteaAccessToken')
  syncStore.setGiteaSyncRepoInfo(undefined)
  if (!accessToken) {
    syncStore.setGiteaSyncRepoState(SyncStateEnum.fail)
    return
  }

  syncStore.setGiteaSyncRepoState(SyncStateEnum.checking)
  try {
    const { getUserInfo } = await import('@/lib/sync/gitea')
    const userInfo = await getUserInfo()
    if (!userInfo) throw new Error('Gitea connection is unavailable')
    syncStore.setGiteaUserInfo(userInfo)
    syncStore.setGiteaSyncRepoState(SyncStateEnum.success)
  } catch (error) {
    console.error('Failed to check Gitea status:', error)
    syncStore.setGiteaSyncRepoState(SyncStateEnum.fail)
  }
}

async function checkS3Status(store: Store) {
  const syncStore = useSyncStore.getState()
  const config = await store.get<S3Config>('s3SyncConfig')
  const configured = config?.accessKeyId && config.secretAccessKey && config.region && config.bucket
  const connected = configured ? await testS3Connection(config).catch(() => false) : false
  const currentConfig = await store.get<S3Config>('s3SyncConfig')
  if (JSON.stringify(currentConfig) === JSON.stringify(config)) {
    syncStore.setS3Connected(connected)
  }
}

async function checkWebDAVStatus(store: Store) {
  const syncStore = useSyncStore.getState()
  const config = await store.get<WebDAVConfig>('webdavSyncConfig')
  const configured = config?.url && config.username && config.password
  const connected = configured ? await testWebDAVConnection(config).catch(() => false) : false
  const currentConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
  if (JSON.stringify(currentConfig) === JSON.stringify(config)) {
    syncStore.setWebDAVConnected(connected)
  }
}

async function checkCloudFolderStatus(store: Store) {
  const syncStore = useSyncStore.getState()
  const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
  const connected = config?.path
    ? await testCloudFolderConnection(config).catch(() => false)
    : false
  const currentConfig = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
  if (JSON.stringify(currentConfig) === JSON.stringify(config)) {
    syncStore.setCloudFolderConnected(connected)
  }
}

export async function checkSyncProviderStatus(platform: SyncPlatform) {
  const store = await Store.load('store.json')

  switch (platform) {
    case 'github':
      return checkGithubStatus(store)
    case 'gitee':
      return checkGiteeStatus(store)
    case 'gitlab':
      return checkGitlabStatus(store)
    case 'gitea':
      return checkGiteaStatus(store)
    case 's3':
      return checkS3Status(store)
    case 'webdav':
      return checkWebDAVStatus(store)
    case 'cloudFolder':
      return checkCloudFolderStatus(store)
  }
}
