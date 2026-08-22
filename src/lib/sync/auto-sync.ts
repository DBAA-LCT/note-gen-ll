import { Store } from '@tauri-apps/plugin-store'
import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { decodeBase64ToString, getFiles as getGithubFiles, getFileCommits as getGithubFileCommits } from '@/lib/sync/github'
import { getFiles as getGiteeFiles, getFileCommits as getGiteeFileCommits } from '@/lib/sync/gitee'
import { getFileContent as getGitlabFileContent, getFileCommits as getGitlabFileCommits, getFiles as getGitlabFiles } from '@/lib/sync/gitlab'
import { getFileContent as getGiteaFileContent, getFileCommits as getGiteaFileCommits, getFiles as getGiteaFiles, getGiteaApiBaseUrl } from '@/lib/sync/gitea'
import { s3HeadObject, s3Download } from './s3'
import { webdavHeadObject, webdavDownload } from './webdav'
import { CloudFolderConfig, S3Config, WebDAVConfig } from '@/types/sync'
import {
  androidCloudFolderWorkspaceDownloadBytes,
  androidCloudFolderWorkspaceHead,
  supportsCloudFolderWorkspace,
} from './cloud-folder'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { getCurrentSyncContext, getSyncMetadataKey } from '@/lib/sync/sync-context'
import { toast } from '@/hooks/use-toast'
import { readTextFile, writeTextFile, stat, mkdir, exists } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import {
  checkFileLock,
  detectAndHandleConflict,
  mergeSimpleContent,
  updateFileSyncTime,
  cleanupExpiredLocks,
} from './conflict-resolution'
import { sanitizeFilePath, hasInvalidFileNameChars } from './filename-utils'
import { useSyncConfirmStore } from '@/stores/sync-confirm'
import emitter from '@/lib/emitter'
import { shouldExclude } from '@/config/sync-exclusions'
import {
  resolvePrimarySyncMapping,
  type ResolvedSyncMapping,
} from './connector-mappings'
import { getSyncBaseline, setSyncBaseline } from './sync-baseline'

// Store 实例缓存
let storeInstance: Store | null = null

/**
 * 获取 Store 实例
 */
async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load('store.json')
  }
  return storeInstance
}

/**
 * 获取 GitLab 分支配置
 */
async function getGitlabBranch(): Promise<string> {
  const store = await getStore()
  return await store.get<string>('gitlabBranch') || 'main'
}

/**
 * 获取 Gitea 分支配置
 */
async function getGiteaBranch(): Promise<string> {
  const store = await getStore()
  return await store.get<string>('giteaBranch') || 'main'
}

/**
 * 从 store 获取本地记录的远程 SHA
 */
export async function getLocalRecordedSha(
  filePath: string,
  selectedMapping?: ResolvedSyncMapping,
): Promise<string | null> {
  const store = await getStore()
  const syncedShas = await store.get<Record<string, string>>('syncedFileShas') || {}
  const scopedKey = await getSyncMetadataKey(filePath, selectedMapping)
  if (syncedShas[scopedKey]) return syncedShas[scopedKey]

  const context = await getCurrentSyncContext()
  return context.workspaceKey === '__default__' ? syncedShas[filePath] || null : null
}

/**
 * 设置本地记录的远程 SHA
 */
export async function setLocalRecordedSha(
  filePath: string,
  sha: string,
  scopedKey?: string,
): Promise<void> {
  const store = await getStore()
  const syncedShas = await store.get<Record<string, string>>('syncedFileShas') || {}
  syncedShas[scopedKey || await getSyncMetadataKey(filePath)] = sha
  await store.set('syncedFileShas', syncedShas)
  await store.save()
}

export interface FileMetadata {
  path: string
  localSha?: string
  remoteSha?: string
  lastModified?: number
  lastSyncTime?: number
  syncStatus: 'synced' | 'local_newer' | 'remote_newer' | 'conflict' | 'unknown'
}

export interface SyncResult {
  shouldUpdate: boolean
  action: 'none' | 'pull' | 'push' | 'conflict'
  localContent?: string
  remoteContent?: string
  reason?: string
}

/**
 * 计算文件内容的 SHA 值
 */
export async function calculateFileSha(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 获取本地文件元数据（增强版，处理文件名兼容性和目录检查）
 */
export async function getLocalFileMetadata(path: string): Promise<FileMetadata> {
  const workspace = await getWorkspacePath()
  
  // 检查并清理文件名
  if (hasInvalidFileNameChars(path)) {
    path = sanitizeFilePath(path)
  }
  
  const pathOptions = await getFilePathOptions(path)
  
  try {
    let fileStat
    if (workspace.isCustom) {
      fileStat = await stat(pathOptions.path)
    } else {
      fileStat = await stat(pathOptions.path, { baseDir: pathOptions.baseDir })
    }

    let content = ''
    if (workspace.isCustom) {
      content = await readTextFile(pathOptions.path)
    } else {
      content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
    }

    return {
      path,
      localSha: await calculateFileSha(content),
      lastModified: fileStat.mtime?.getTime(),
      syncStatus: 'unknown'
    }
  } catch (error) {
    // 如果是目录不存在的错误，这是正常的，返回未知状态
    if (error instanceof Error && 
        (error.message.includes('no such file') || 
         error.message.includes('not found') ||
         error.message.includes('系统找不到指定的路径'))) {
      return {
        path,
        syncStatus: 'unknown'
      }
    }
    
    return {
      path,
      syncStatus: 'unknown'
    }
  }
}

/**
 * 获取远程文件信息
 */
export interface RemoteFileInfo {
  sha?: string
  lastModified?: number
  exists: boolean
}

export async function getRemoteFileInfo(
  path: string,
  selectedMapping?: ResolvedSyncMapping,
): Promise<RemoteFileInfo> {
  const store = await Store.load('store.json')
  const mapping = selectedMapping || await resolvePrimarySyncMapping(path, undefined, 'read')
  if (!mapping) return { exists: false }
  const remotePath = mapping.remoteFilePath
  let file

  switch (mapping.platform) {
    case 'github': {
      const repo = mapping.remoteTarget || await getSyncRepoName('github', path)
      file = await getGithubFiles({ path: remotePath, repo })
      if (!file) return { exists: false }
      const commits = await getGithubFileCommits({ path: remotePath, repo })
      return {
        exists: true,
        sha: file.sha,
        lastModified: commits?.length
          ? new Date(commits[0].commit.committer.date).getTime()
          : undefined,
      }
    }
    case 'gitee': {
      const repo = mapping.remoteTarget || await getSyncRepoName('gitee', path)
      file = await getGiteeFiles({ path: remotePath, repo })
      if (!file) return { exists: false }
      const commits = await getGiteeFileCommits({ path: remotePath, repo })
      return {
        exists: true,
        sha: file.sha,
        lastModified: commits?.length
          ? new Date(commits[0].commit.committer.date).getTime()
          : undefined,
      }
    }
    case 'gitlab': {
      const repo = mapping.remoteTarget || await getSyncRepoName('gitlab', path)
      file = await getGitlabFiles({ path: remotePath, repo })
      if (!file || Array.isArray(file)) return { exists: false }
      const commits = await getGitlabFileCommits({ path: remotePath, repo })
      const latestCommit = commits ? commits.data?.[0] : undefined
      return {
        exists: true,
        sha: file.sha,
        lastModified: latestCommit?.committed_date
          ? new Date(latestCommit.committed_date).getTime()
          : undefined,
      }
    }
    case 'gitea': {
      const repo = mapping.remoteTarget || await getSyncRepoName('gitea', path)
      file = await getGiteaFiles({ path: remotePath, repo })
      if (!file || Array.isArray(file)) return { exists: false }
      const commits = await getGiteaFileCommits({ path: remotePath, repo })
      const latestCommit = commits ? commits.data?.[0] : undefined
      return {
        exists: true,
        sha: file.sha,
        lastModified: latestCommit?.commit?.committer?.date
          ? new Date(latestCommit.commit.committer.date).getTime()
          : undefined,
      }
    }
    case 'cloudFolder': {
      const stored = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
      if (!stored) throw new Error('网盘文件夹未配置')
      const config = { ...stored, path: mapping.remoteTarget || stored.path }
      const object = config.path && supportsCloudFolderWorkspace(config)
        ? await androidCloudFolderWorkspaceHead(config, remotePath)
        : null
      return object
        ? { exists: true, sha: object.etag, lastModified: object.modifiedAt }
        : { exists: false }
    }
    case 's3': {
      const stored = await store.get<S3Config>('s3SyncConfig')
      if (!stored) throw new Error('S3 未配置')
      const config = { ...stored, bucket: mapping.remoteTarget || stored.bucket }
      const proxyUrl = await store.get<string>('proxy')
      const object = await s3HeadObject(config, remotePath, proxyUrl ? { all: proxyUrl } : undefined)
      return object
        ? { exists: true, sha: object.etag, lastModified: new Date(object.lastModified).getTime() }
        : { exists: false }
    }
    case 'webdav': {
      const stored = await store.get<WebDAVConfig>('webdavSyncConfig')
      if (!stored) throw new Error('WebDAV 未配置')
      const config = { ...stored, url: mapping.remoteTarget || stored.url }
      const proxyUrl = await store.get<string>('proxy')
      const object = await webdavHeadObject(config, remotePath, proxyUrl ? { all: proxyUrl } : undefined)
      return object
        ? { exists: true, sha: object.etag, lastModified: new Date(object.lastModified).getTime() }
        : { exists: false }
    }
  }
}

/**
 * 使用 mapping-scoped 基线执行三方比较：本地内容 SHA、远程 revision/存在性、上次同步状态。
 * revision 不可用时下载远端内容计算 SHA，绝不以 mtime 作为覆盖依据。
 */
export async function compareFileVersions(
  path: string,
  selectedMapping?: ResolvedSyncMapping,
): Promise<SyncResult> {
  const mapping = selectedMapping || await resolvePrimarySyncMapping(path, undefined, 'read')
  if (!mapping) return { shouldUpdate: false, action: 'none', reason: '没有匹配的同步映射' }

  const localMeta = await getLocalFileMetadata(path)
  const remoteInfo = await getRemoteFileInfo(path, mapping)
  const baseline = await getSyncBaseline(path, mapping)

  if (!baseline) {
    if (!localMeta.localSha && !remoteInfo.exists) {
      return { shouldUpdate: false, action: 'none' }
    }
    if (!localMeta.localSha) {
      return { shouldUpdate: true, action: 'pull', reason: '本地文件不存在，需要从远程拉取' }
    }
    if (!remoteInfo.exists) {
      return { shouldUpdate: true, action: 'push', reason: '远程文件不存在，需要推送到远程' }
    }

    // Legacy syncedFileShas only tracks the remote side. Without a local-content
    // baseline it cannot prove that the local file is unchanged, so compare the
    // actual content instead of trusting mtime or silently adopting the revision.
    const remoteContent = await pullRemoteFile(path, mapping)
    const remoteContentSha = await calculateFileSha(remoteContent)
    if (remoteContentSha !== localMeta.localSha) {
      return {
        shouldUpdate: true,
        action: 'conflict',
        localContent: undefined,
        remoteContent,
        reason: '缺少本地同步基线且两端内容不同，需要手动处理',
      }
    }
    await setSyncBaseline(path, mapping, {
      lastLocalContentSha: localMeta.localSha,
      lastRemoteRevision: remoteInfo.sha,
      remoteExists: true,
    })
    return { shouldUpdate: false, action: 'none', reason: '两端内容一致，已建立同步基线' }
  }

  const localChanged = localMeta.localSha !== baseline.lastLocalContentSha
  let remoteChanged = remoteInfo.exists !== baseline.remoteExists
  if (!remoteChanged && remoteInfo.exists) {
    if (baseline.lastRemoteRevision && remoteInfo.sha) {
      remoteChanged = baseline.lastRemoteRevision !== remoteInfo.sha
    } else {
      const remoteContent = await pullRemoteFile(path, mapping)
      remoteChanged = await calculateFileSha(remoteContent) !== baseline.lastLocalContentSha
    }
  }

  if (localChanged && remoteChanged) {
    return { shouldUpdate: true, action: 'conflict', reason: '本地和远程均在上次同步后发生变更' }
  }
  if (localChanged) {
    if (mapping.accessMode === 'read-only') {
      return { shouldUpdate: true, action: 'conflict', reason: '只读映射的本地文件已发生变更' }
    }
    return localMeta.localSha
      ? { shouldUpdate: true, action: 'push', reason: '本地文件在上次同步后发生变更' }
      : { shouldUpdate: true, action: 'conflict', reason: '检测到本地删除，需要手动确认' }
  }
  if (remoteChanged) {
    return remoteInfo.exists
      ? { shouldUpdate: true, action: 'pull', reason: '远程文件在上次同步后发生变更' }
      : { shouldUpdate: true, action: 'conflict', reason: '检测到远程删除，需要手动确认' }
  }

  return { shouldUpdate: false, action: 'none', reason: '本地和远程均未变更' }
}

/**
 * 从远程拉取文件内容
 */
export async function pullRemoteFile(
  path: string,
  selectedMapping?: ResolvedSyncMapping,
): Promise<string> {
  const store = await Store.load('store.json')
  const mapping = selectedMapping || await resolvePrimarySyncMapping(path, undefined, 'read')
  if (mapping?.syncPolicy === 'ignore-remote') throw new Error('当前远端文件已设为不拉取')
  if (!mapping) throw new Error('没有匹配的同步映射')
  const primaryBackupMethod = mapping.platform
  const remotePath = mapping.remoteFilePath

  try {
    let file
    switch (primaryBackupMethod) {
      case 'github':
        const githubRepo = mapping.remoteTarget
        file = await getGithubFiles({ path: remotePath, repo: githubRepo })
        if (file && typeof file.content === 'string') {
          return decodeBase64ToString(file.content)
        }
        break

      case 'gitee':
        const giteeRepo = mapping.remoteTarget
        file = await getGiteeFiles({ path: remotePath, repo: giteeRepo })
        if (file && typeof file.content === 'string') {
          return decodeBase64ToString(file.content)
        }
        break

      case 'gitlab': {
        const gitlabRepo = mapping.remoteTarget
        const gitlabBranch = await getGitlabBranch()
        file = await getGitlabFileContent({ path: remotePath, ref: gitlabBranch, repo: gitlabRepo })
        if (file && typeof file.content === 'string') {
          return decodeBase64ToString(file.content)
        }
        break
      }

      case 'gitea': {
        const giteaRepo = mapping.remoteTarget
        const giteaBranch = await getGiteaBranch()
        file = await getGiteaFileContent({ path: remotePath, ref: giteaBranch, repo: giteaRepo })
        if (file && typeof file.content === 'string') {
          return decodeBase64ToString(file.content)
        }
        break
      }

      case 's3': {
        const stored = await store.get<S3Config>('s3SyncConfig')
        const s3Config = stored
          ? { ...stored, bucket: mapping.remoteTarget || stored.bucket }
          : null
        if (s3Config) {
          const s3File = await s3Download(s3Config, remotePath)
          if (s3File) {
            return s3File.content
          }
        }
        break
      }

      case 'webdav': {
        const stored = await store.get<WebDAVConfig>('webdavSyncConfig')
        const webdavConfig = stored
          ? { ...stored, url: mapping.remoteTarget || stored.url }
          : null
        if (webdavConfig) {
          const webdavFile = await webdavDownload(webdavConfig, remotePath)
          if (webdavFile) {
            return webdavFile.content
          }
        }
        break
      }

      case 'cloudFolder': {
        const stored = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
        const config = stored
          ? { ...stored, path: mapping.remoteTarget || stored.path }
          : null
        const cloudFile = config?.path && supportsCloudFolderWorkspace(config)
          ? await androidCloudFolderWorkspaceDownloadBytes(config, remotePath)
          : null
        if (cloudFile) {
          return new TextDecoder().decode(cloudFile.content)
        }
        break
      }
    }
  } catch (error) {
    throw error
  }

  throw new Error('无法获取远程文件内容')
}

/**
 * 确保目录存在，如果不存在则创建
 */
export async function ensureDirectoryExists(filePath: string): Promise<void> {
  const workspace = await getWorkspacePath()
  
  // 检查并清理文件名
  if (hasInvalidFileNameChars(filePath)) {
    filePath = sanitizeFilePath(filePath)
  }
  
  // 提取目录路径
  const dirPath = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : ''
  
  if (!dirPath) {
    return // 根目录，无需创建
  }
  
  const pathOptions = await getFilePathOptions(dirPath)
  
  try {
    let dirExists = false
    if (workspace.isCustom) {
      dirExists = await exists(pathOptions.path)
    } else {
      dirExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
    }
    
    if (!dirExists) {
      // 递归创建目录
      if (workspace.isCustom) {
        await mkdir(pathOptions.path, { recursive: true })
      } else {
        await mkdir(pathOptions.path, { baseDir: pathOptions.baseDir, recursive: true })
      }
    }
  } catch (error) {
    throw error
  }
}

/**
 * 保存文件到本地（增强版，处理文件名兼容性和目录创建）
 */
export async function saveLocalFile(path: string, content: string): Promise<void> {
  const workspace = await getWorkspacePath()
  
  // 检查并清理文件名
  if (hasInvalidFileNameChars(path)) {
    path = sanitizeFilePath(path)
  }
  
  // 确保目录存在
  await ensureDirectoryExists(path)
  
  const pathOptions = await getFilePathOptions(path)
  
  try {
    if (workspace.isCustom) {
      await writeTextFile(pathOptions.path, content)
    } else {
      await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
    }
  } catch (error) {
    throw error
  }
}

/**
 * 获取远程文件的最新 commit 信息
 */
export async function getRemoteCommitInfo(
  path: string,
  selectedMapping?: ResolvedSyncMapping,
): Promise<{
  sha: string
  message: string
  author: string
  date: Date
  additions?: number
  deletions?: number
} | null> {
  try {
    const mapping = selectedMapping || await resolvePrimarySyncMapping(path, undefined, 'read')
    if (!mapping || !['github', 'gitee', 'gitlab', 'gitea'].includes(mapping.platform)) return null
    const platform = mapping.platform
    const repo = mapping.remoteTarget
    const remotePath = mapping.remoteFilePath
    
    let commits: any[] = []
    
    switch (platform) {
      case 'github':
        commits = await getGithubFileCommits({ path: remotePath, repo })
        break
      case 'gitee':
        commits = await getGiteeFileCommits({ path: remotePath, repo })
        break
      case 'gitlab':
        const gitlabResult = await getGitlabFileCommits({ path: remotePath, repo })
        commits = gitlabResult && 'data' in gitlabResult ? gitlabResult.data : []
        break
      case 'gitea':
        const giteaResult = await getGiteaFileCommits({ path: remotePath, repo })
        commits = giteaResult && 'data' in giteaResult ? giteaResult.data : []
        break
    }
    
    if (!commits || commits.length === 0) {
      return null
    }
    
    const latestCommit = commits[0]
    
    // 提取 commit 信息
    let author = 'Unknown'
    let message = 'No message'
    let date = new Date()
    let sha = ''
    let additions: number | undefined
    let deletions: number | undefined
    
    if (platform === 'github') {
      author = latestCommit.commit?.author?.name || 'Unknown'
      message = latestCommit.commit?.message || 'No message'
      date = new Date(latestCommit.commit?.author?.date || Date.now())
      sha = latestCommit.sha || ''
      additions = latestCommit.stats?.additions
      deletions = latestCommit.stats?.deletions
    } else if (platform === 'gitee') {
      author = latestCommit.author?.name || 'Unknown'
      message = latestCommit.message || 'No message'
      date = new Date(latestCommit.created_at || Date.now())
      sha = latestCommit.sha || ''
    } else if (platform === 'gitlab') {
      author = latestCommit.author_name || 'Unknown'
      message = latestCommit.message || 'No message'
      date = new Date(latestCommit.created_at || Date.now())
      sha = latestCommit.id || ''
    } else if (platform === 'gitea') {
      author = latestCommit.commit?.author?.name || 'Unknown'
      message = latestCommit.commit?.message || 'No message'
      date = new Date(latestCommit.commit?.author?.date || Date.now())
      sha = latestCommit.sha || ''
    }
    
    return {
      sha,
      message,
      author,
      date,
      additions,
      deletions
    }
  } catch {
    return null
  }
}

/**
 * 自动同步检测和处理（增强版，包含冲突处理和 commit 信息展示）
 */
export async function autoSyncIfNeeded(path: string, options: {
  autoPull?: boolean
  showConfirm?: boolean
  enableConflictResolution?: boolean
} = {}): Promise<string | null> {
  if (shouldExclude(path)) return null

  const { autoPull = true, showConfirm = false, enableConflictResolution = true } = options
  
  try {
    // 清理过期锁
    await cleanupExpiredLocks()
    
    // 检查文件是否被其他设备锁定
    if (enableConflictResolution) {
      const lockInfo = await checkFileLock(path)
      if (lockInfo) {
        toast({
          title: '文件锁定',
          description: `文件正在被 ${lockInfo.userName} 在其他设备上编辑`,
          variant: 'destructive'
        })
        return null
      }
    }
    
    const mapping = await resolvePrimarySyncMapping(path, undefined, 'read')
    if (!mapping) return null
    const syncResult = await compareFileVersions(path, mapping)
    
    if (!syncResult.shouldUpdate || syncResult.action === 'none') {
      return null
    }
    
    if (syncResult.action === 'pull' && autoPull && mapping.autoPullOnOpen) {
      if (showConfirm) {
        // 获取 commit 信息
        const commitInfo = await getRemoteCommitInfo(path, mapping)

        // 使用新的拉取确认对话框
        return new Promise<string | null>((resolve) => {
          useSyncConfirmStore.getState().showPullDialog({
            fileName: path || '',
            commitInfo: commitInfo || undefined,
            onConfirm: async () => {
              try {
                // 执行实际的同步逻辑
                const result = await performSync(path || '', enableConflictResolution, mapping)
                resolve(result)
              } catch {
                resolve(null)
              }
            },
            onCancel: () => {
              resolve(null)
            }
          })
        })
      } else {
        // 直接执行同步（不显示确认对话框）
        return await performSync(path, enableConflictResolution, mapping)
      }
    }
    
    return null
  } catch {
    return null
  }
}

/**
 * 执行实际的同步操作
 */
async function performSync(
  path: string,
  enableConflictResolution: boolean,
  mapping: ResolvedSyncMapping,
): Promise<string | null> {
  try {
    // 获取本地内容用于冲突检测
    let localContent = ''
    let actualPath = path
    
    // 检查并清理文件名
    if (hasInvalidFileNameChars(path)) {
      actualPath = sanitizeFilePath(path)
    }
    
    try {
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(actualPath)
      if (workspace.isCustom) {
        localContent = await readTextFile(pathOptions.path)
      } else {
        localContent = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
    } catch (error) {
      // 本地文件不存在或目录不存在，这是正常的同步场景
      if (error instanceof Error && 
          (error.message.includes('no such file') || 
           error.message.includes('not found') ||
           error.message.includes('系统找不到指定的路径'))) {
      } else {
        // 静默处理读取本地文件时的意外错误
      }
      // 继续处理，将直接拉取远程文件
    }
    
    const remoteContent = await pullRemoteFile(path, mapping)

    // 获取远程文件的 SHA，用于后续更新记录的 SHA
    const remoteInfo = await getRemoteFileInfo(path, mapping)
    const remoteSha = remoteInfo.sha

    // 检测和处理冲突
    if (enableConflictResolution && localContent && localContent !== remoteContent) {
      const resolution = await detectAndHandleConflict(path, localContent, remoteContent)
      
      let finalContent = remoteContent
      switch (resolution.action) {
        case 'keep_local':
          finalContent = localContent
          toast({
            title: '冲突处理',
            description: '保留本地版本'
          })
          break
        case 'keep_remote':
          finalContent = remoteContent
          toast({
            title: '冲突处理',
            description: '使用远程版本'
          })
          break
        case 'merge':
          finalContent = mergeSimpleContent(localContent, remoteContent)
          toast({
            title: '冲突处理',
            description: '自动合并成功'
          })
          break
        case 'manual':
          toast({
            title: '需要手动处理',
            description: '冲突较复杂，请手动处理',
            variant: 'destructive'
          })
          return null
      }
      
      await saveLocalFile(actualPath, finalContent)
      await updateFileSyncTime(actualPath)

      // 只有实际采用远端内容时才能推进基线；保留本地或合并内容仍未上传。
      if (finalContent === remoteContent) {
        if (remoteSha) {
          await setLocalRecordedSha(actualPath, remoteSha, await getSyncMetadataKey(actualPath, mapping))
        }
        await setSyncBaseline(actualPath, mapping, {
          lastLocalContentSha: await calculateFileSha(finalContent),
          lastRemoteRevision: remoteSha,
          remoteExists: true,
        })
      }

      // 通知编辑器内容已更新
      emitter.emit('sync-content-updated', { path: actualPath, content: finalContent })

      return finalContent
    } else {
      // 无冲突，直接保存
      await saveLocalFile(actualPath, remoteContent)
      await updateFileSyncTime(actualPath)

      // 成功拉取后，更新兼容记录和三方同步基线
      if (remoteSha) {
        await setLocalRecordedSha(actualPath, remoteSha, await getSyncMetadataKey(actualPath, mapping))
      }
      await setSyncBaseline(actualPath, mapping, {
        lastLocalContentSha: await calculateFileSha(remoteContent),
        lastRemoteRevision: remoteSha,
        remoteExists: true,
      })

      // 通知编辑器内容已更新
      emitter.emit('sync-content-updated', { path: actualPath, content: remoteContent })

      return remoteContent
    }
  } catch {
    return null
  }
  
  return null
}

/**
 * 检查网络连接状态
 */
export async function hasNetworkConnection(): Promise<boolean> {
  try {
    const store = await Store.load('store.json')
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github'

    // 真正的网络检测：尝试发送请求到 API 端点
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10秒超时

    let url = ''
    let token = ''
    let proxy: Proxy | undefined = undefined

    switch (primaryBackupMethod) {
      case 'github':
        token = await store.get<string>('accessToken') || ''
        url = 'https://api.github.com/user'
        break
      case 'gitee':
        token = await store.get<string>('giteeAccessToken') || ''
        url = 'https://gitee.com/api/v5/user'
        break
      case 'gitlab':
        token = await store.get<string>('gitlabAccessToken') || ''
        const gitlabUrl = await store.get<string>('gitlabUrl') || 'https://gitlab.com'
        url = `${gitlabUrl}/api/v4/user`
        break
      case 'gitea':
        token = await store.get<string>('giteaAccessToken') || ''
        url = `${await getGiteaApiBaseUrl()}/user`
        // Gitea 自建实例可能需要代理
        const giteaProxyUrl = await store.get<string>('proxy')
        if (giteaProxyUrl) {
          proxy = { all: giteaProxyUrl }
        }
        break
      case 'cloudFolder': {
        clearTimeout(timeoutId)
        const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
        return Boolean(config && supportsCloudFolderWorkspace(config))
      }
      case 's3': {
        clearTimeout(timeoutId)
        const config = await store.get<S3Config>('s3SyncConfig')
        return Boolean(
          config?.accessKeyId.trim()
          && config.secretAccessKey.trim()
          && config.region.trim()
          && config.bucket.trim()
        )
      }
      case 'webdav': {
        clearTimeout(timeoutId)
        const config = await store.get<WebDAVConfig>('webdavSyncConfig')
        return Boolean(
          config?.url.trim()
          && config.username.trim()
          && config.password.trim()
        )
      }
      default:
        clearTimeout(timeoutId)
        return false
    }

    if (!token) {
      clearTimeout(timeoutId)
      return false
    }

    const fetchOptions: any = {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }

    // Gitea 自建实例使用代理
    if (proxy) {
      fetchOptions.proxy = proxy
    }

    const response = await fetch(url, fetchOptions)

    clearTimeout(timeoutId)
    return response.ok
  } catch (error) {
    // 网络错误、超时等
    console.error('Network connection check failed:', error)
    return false
  }
}

/**
 * 比较 S3 本地和远程文件版本
 * 使用 ETag 进行比较
 */
export async function compareS3FileVersions(
  path: string,
  selectedMapping?: ResolvedSyncMapping,
): Promise<SyncResult> {
  const mapping = selectedMapping || await resolvePrimarySyncMapping(path, undefined, 'read')
  if (!mapping || mapping.platform !== 's3') {
    return { shouldUpdate: false, action: 'none', reason: 'S3 未配置' }
  }
  return compareFileVersions(path, mapping)
}

/**
 * 比较 WebDAV 本地和远程文件版本
 * 使用 ETag 进行比较
 */
export async function compareWebDAVFileVersions(
  path: string,
  selectedMapping?: ResolvedSyncMapping,
): Promise<SyncResult> {
  const mapping = selectedMapping || await resolvePrimarySyncMapping(path, undefined, 'read')
  if (!mapping || mapping.platform !== 'webdav') {
    return { shouldUpdate: false, action: 'none', reason: 'WebDAV 未配置' }
  }
  return compareFileVersions(path, mapping)
}
