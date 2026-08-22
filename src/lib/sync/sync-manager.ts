import { Store } from '@tauri-apps/plugin-store'
import { calculateFileSha, getLocalFileMetadata, getRemoteFileInfo, compareFileVersions, pullRemoteFile, saveLocalFile, setLocalRecordedSha } from './auto-sync'
import { getSyncMetadataKey } from './sync-context'
import { getSyncBaseline, setSyncBaseline } from './sync-baseline'
import { decodeBase64ToString } from './github'
import { updateFileSyncTime } from './conflict-resolution'
import { getOptionalSyncRepoName } from './repo-utils'
import { uploadFile as uploadToGithub, getFiles as getGithubFiles, deleteFile as deleteGithubFile } from './github'
import { uploadFile as uploadToGitee, getFiles as getGiteeFiles, deleteFile as deleteGiteeFile } from './gitee'
import { uploadFile as uploadToGitlab, getFileContent as getGitlabFile, deleteFile as deleteGitlabFile } from './gitlab'
import { uploadFile as uploadToGitea, getFileContent as getGiteaFile, deleteFile as deleteGiteaFile } from './gitea'
import { s3Upload, s3Download, s3Delete } from './s3'
import { webdavUpload, webdavDownload, webdavDelete } from './webdav'
import {
  androidCloudFolderWorkspaceDelete,
  androidCloudFolderWorkspaceDownloadBytes,
  androidCloudFolderWorkspaceUpload,
  supportsCloudFolderWorkspace,
} from './cloud-folder'
import { CloudFolderConfig, S3Config, WebDAVConfig } from '@/types/sync'
import useSyncStore from '@/stores/sync'
import { toast } from '@/hooks/use-toast'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { shouldExclude } from '@/config/sync-exclusions'
import {
  resolvePrimarySyncMapping,
  resolveSyncMappings,
  getSyncPathWritePolicy,
  type ResolvedSyncMapping,
} from '@/lib/sync/connector-mappings'
import {
  ActiveSyncPaths,
  hasRemoteFileContent,
  shouldAutoApplyRemote,
  shouldRecordSuccessfulSync,
} from '@/lib/sync/sync-logic'

/**
 * 获取 GitLab 分支配置
 */
async function getGitlabBranch(): Promise<string> {
  const store = await Store.load('store.json')
  return await store.get<string>('gitlabBranch') || 'main'
}

/**
 * 获取 Gitea 分支配置
 */
async function getGiteaBranch(): Promise<string> {
  const store = await Store.load('store.json')
  return await store.get<string>('giteaBranch') || 'main'
}

/**
 * 获取 S3 配置
 */
async function getS3Config(): Promise<S3Config | null> {
  const store = await Store.load('store.json')
  const config = await store.get<S3Config>('s3SyncConfig')
  if (config && config.accessKeyId && config.secretAccessKey && config.region && config.bucket) {
    return { ...config }
  }
  return null
}

/**
 * 获取 WebDAV 配置
 */
async function getWebDAVConfig(): Promise<WebDAVConfig | null> {
  const store = await Store.load('store.json')
  const config = await store.get<WebDAVConfig>('webdavSyncConfig')
  if (config && config.url && config.username && config.password) {
    return { ...config }
  }
  return null
}

async function getCloudFolderWorkspaceConfig(): Promise<CloudFolderConfig | null> {
  const store = await Store.load('store.json')
  const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
  return config && supportsCloudFolderWorkspace(config) ? { ...config } : null
}

// 同步配置
export interface SyncConfig {
  autoSync: boolean           // 自动同步总开关
  autoPushOnSave: boolean     // 保存时自动推送
  autoPullOnOpen: boolean     // 打开或切换文件时自动拉取
  conflictPolicy: 'ask' | 'local' | 'remote'
}

export const defaultSyncConfig: SyncConfig = {
  autoSync: true,
  autoPushOnSave: true,
  autoPullOnOpen: true,       // 默认开启
  conflictPolicy: 'ask'
}

// 同步状态
export interface SyncState {
  isSyncing: boolean          // 是否正在同步
  pendingSync: boolean         // 是否有待同步的变更
  lastSyncTime: number        // 最后同步时间
  lastSyncSha: string         // 最后同步的 SHA
  syncStatus: 'synced' | 'local_newer' | 'remote_newer' | 'conflict' | 'unknown'
}

// 同步结果
export interface SyncResult {
  success: boolean
  action: 'push' | 'pull' | 'delete' | 'none' | 'conflict'
  message?: string
  error?: string
  content?: string
}

// 同步日志
export interface SyncLog {
  timestamp: number
  action: 'push' | 'pull' | 'delete'
  filePath: string
  success: boolean
  error?: string
}

// 同步管理器
export class SyncManager {
  private config: SyncConfig = { ...defaultSyncConfig }
  private state: SyncState = {
    isSyncing: false,
    pendingSync: false,
    lastSyncTime: 0,
    lastSyncSha: '',
    syncStatus: 'unknown'
  }
  private syncQueue: Map<string, { timestamp: number }> = new Map()
  private activeSyncPaths = new ActiveSyncPaths()
  private processingSyncQueue = false
  private throttleTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.loadConfig()
  }

  /**
   * 加载配置
   */
  async loadConfig(): Promise<void> {
    try {
      // 先从 sync_config.json 加载配置
      const syncStore = await Store.load('sync_config.json')
      const savedConfig = await syncStore.get<SyncConfig>('config')
      if (savedConfig) {
        this.config = { ...defaultSyncConfig, ...savedConfig }
      }

      // 再从 store.json 读取设置中的 autoPull 配置
      const settingStore = await Store.load('store.json')
      const autoPullOnOpen = await settingStore.get<boolean>('autoPullOnOpen')

      // 覆盖配置
      if (autoPullOnOpen !== undefined && autoPullOnOpen !== null) {
        this.config.autoPullOnOpen = autoPullOnOpen
      }
    } catch {
      // 静默处理配置加载错误
    }
  }

  /**
   * 保存配置
   */
  async saveConfig(): Promise<void> {
    try {
      const store = await Store.load('sync_config.json')
      await store.set('config', this.config)
      await store.save()
    } catch {
      // 静默处理配置保存错误
    }
  }

  /**
   * 更新配置
   */
  async updateConfig(config: Partial<SyncConfig>): Promise<void> {
    this.config = { ...this.config, ...config }
    await this.saveConfig()
  }

  /**
   * 获取配置
   */
  getConfig(): SyncConfig {
    return { ...this.config }
  }

  /**
   * 获取同步状态
   */
  getState(): SyncState {
    return { ...this.state }
  }

  /**
   * 获取当前使用的平台
   */
  async getCurrentPlatform(path = ''): Promise<string> {
    const mapping = await resolvePrimarySyncMapping(path)
    if (mapping) return mapping.platform
    const store = await Store.load('store.json')
    return await store.get<string>('primaryBackupMethod') || 'github'
  }

  /**
   * 计算文件的 SHA
   */
  async calculateSha(content: string): Promise<string> {
    return await calculateFileSha(content)
  }

  /**
   * 获取本地文件 SHA
   */
  async getLocalSha(path: string): Promise<string | null> {
    const meta = await getLocalFileMetadata(path)
    return meta.localSha || null
  }

  /**
   * 获取远程文件 SHA
   */
  async getRemoteSha(path: string, selectedMapping?: ResolvedSyncMapping): Promise<string | null> {
    const info = await getRemoteFileInfo(path, selectedMapping)
    return info.sha || null
  }

  /**
   * 推送文件到远程
   */
  async pushFile(path: string, content: string, selectedMapping?: ResolvedSyncMapping): Promise<SyncResult> {
    // 检查是否应该排除
    if (shouldExclude(path)) {
      return { success: true, action: 'none', message: '文件被排除在同步之外' }
    }

    try {
      if (!selectedMapping) {
        const mappings = await resolveSyncMappings(path, undefined, 'write')
        if (mappings.length > 1) {
          const results = []
          for (const mapping of mappings) results.push(await this.pushFile(path, content, mapping))
          const failed = results.find(result => !result.success)
          return failed || { success: true, action: 'push', message: '已同步到所有匹配映射' }
        }
        selectedMapping = mappings[0]
      }
      const mapping = selectedMapping
      if (!mapping) return { success: true, action: 'none', message: '没有匹配的同步映射' }
      if (mapping.accessMode === 'read-only') {
        return { success: false, action: 'none', error: '当前映射为只读，不允许上传' }
      }
      const platform = mapping.platform
      const remotePath = mapping.remoteFilePath
      const repo = (platform === 's3' || platform === 'webdav' || platform === 'cloudFolder') ? '' : mapping.remoteTarget
      const baseline = await getSyncBaseline(path, mapping)
      const remoteInfoBeforeWrite = await getRemoteFileInfo(path, mapping)
      if (mapping.syncPolicy !== 'ignore-remote') {
        const existenceChanged = baseline
          ? baseline.remoteExists !== remoteInfoBeforeWrite.exists
          : remoteInfoBeforeWrite.exists
        const revisionChanged = Boolean(
          baseline?.lastRemoteRevision
          && remoteInfoBeforeWrite.sha
          && baseline.lastRemoteRevision !== remoteInfoBeforeWrite.sha
        )
        if (existenceChanged || revisionChanged) {
          return {
            success: false,
            action: 'conflict',
            error: '远程文件在写入前发生变化，已阻止覆盖',
          }
        }
      }
      const sha = (platform === 's3' || platform === 'webdav' || platform === 'cloudFolder')
        ? undefined
        : remoteInfoBeforeWrite.sha
      const message = `Sync: ${path} - ${new Date().toLocaleString('zh-CN')}`
      const filename = path.split('/').pop() || path

      let uploadSuccess = false
      let uploadedRevision: string | undefined

      switch (platform) {
        case 'github': {
          const result = await uploadToGithub({ file: content, sha, message, repo, path: remotePath, filename })
          uploadSuccess = !!result
          break
        }
        case 'gitee': {
          const result = await uploadToGitee({ file: content, sha, message, repo, path: remotePath, filename })
          uploadSuccess = !!result
          break
        }
        case 'gitlab': {
          const result = await uploadToGitlab({ file: content, sha, message, repo, path: remotePath, filename })
          uploadSuccess = !!result
          break
        }
        case 'gitea': {
          const result = await uploadToGitea({ file: content, sha, message, repo, path: remotePath, filename })
          uploadSuccess = !!result
          break
        }
        case 's3': {
          const s3Config = await getS3Config()
          if (!s3Config) {
            return { success: false, action: 'push', error: 'S3 配置未找到' }
          }
          s3Config.bucket = mapping.remoteTarget || s3Config.bucket
          // S3 使用相对路径作为 key，不需要添加 pathPrefix
          const result = await s3Upload(
            s3Config,
            remotePath,
            content,
            undefined,
            'text/markdown; charset=utf-8',
            mapping.syncPolicy === 'ignore-remote'
              ? { throwOnError: true }
              : {
                  throwOnError: true,
                  ifMatch: remoteInfoBeforeWrite.exists ? baseline?.lastRemoteRevision || remoteInfoBeforeWrite.sha : undefined,
                  ifNoneMatch: !remoteInfoBeforeWrite.exists,
                },
          )
          uploadSuccess = !!result
          if (uploadSuccess && result) {
            uploadedRevision = result.etag
            // 保留 path-only ETag 作为 UI 缓存；同步正确性使用 scoped baseline。
            useSyncStore.getState().updateS3FileEtag(path, result.etag)
          }
          break
        }
        case 'webdav': {
          const webdavConfig = await getWebDAVConfig()
          if (!webdavConfig) {
            return { success: false, action: 'push', error: 'WebDAV 配置未找到' }
          }
          webdavConfig.url = mapping.remoteTarget || webdavConfig.url
          const result = await webdavUpload(
            webdavConfig,
            remotePath,
            content,
            undefined,
            'text/markdown; charset=utf-8',
            mapping.syncPolicy === 'ignore-remote'
              ? { throwOnError: true }
              : {
                  throwOnError: true,
                  ifMatch: remoteInfoBeforeWrite.exists ? baseline?.lastRemoteRevision || remoteInfoBeforeWrite.sha : undefined,
                  ifNoneMatch: !remoteInfoBeforeWrite.exists,
                },
          )
          uploadSuccess = !!result
          if (uploadSuccess && result) {
            uploadedRevision = result.etag
            // 保留 path-only ETag 作为 UI 缓存；同步正确性使用 scoped baseline。
            useSyncStore.getState().updateWebDAVFileEtag(path, result.etag)
          }
          break
        }
        case 'cloudFolder': {
          const config = await getCloudFolderWorkspaceConfig()
          if (!config) {
            return { success: false, action: 'push', error: '网盘文件夹未配置' }
          }
          config.path = mapping.remoteTarget || config.path
          const result = await androidCloudFolderWorkspaceUpload(config, remotePath, content)
          uploadSuccess = Boolean(result)
          uploadedRevision = result?.etag
          break
        }
      }

      if (uploadSuccess) {
        const remoteInfo = uploadedRevision
          ? { exists: true, sha: uploadedRevision }
          : await getRemoteFileInfo(path, mapping)
        if (remoteInfo.sha) {
          await setLocalRecordedSha(
            path,
            remoteInfo.sha,
            await getSyncMetadataKey(path, mapping),
          )
        }
        await setSyncBaseline(path, mapping, {
          lastLocalContentSha: await calculateFileSha(content),
          lastRemoteRevision: remoteInfo.sha,
          remoteExists: true,
        })
        await this.logSync(path, 'push', true)
        return { success: true, action: 'push', message: '推送成功' }
      }

      await this.logSync(path, 'push', false, '推送失败')
      return { success: false, action: 'push', error: '推送失败' }
    } catch (error) {
      await this.logSync(path, 'push', false, String(error))
      return { success: false, action: 'push', error: String(error) }
    }
  }

  /**
   * 从远程拉取文件
   */
  async pullFile(path: string, selectedMapping?: ResolvedSyncMapping): Promise<SyncResult> {
    if (shouldExclude(path)) {
      return { success: true, action: 'none', message: '文件被排除在同步之外' }
    }
    try {
      const mapping = selectedMapping || await resolvePrimarySyncMapping(path, undefined, 'read')
      if (mapping?.syncPolicy === 'ignore-remote') return { success: true, action: 'none', message: '当前远端文件已设为不拉取' }
      if (!mapping) return { success: true, action: 'none', message: '没有匹配的同步映射' }
      const platform = mapping.platform
      const remotePath = mapping.remoteFilePath
      const repo = (platform === 's3' || platform === 'webdav' || platform === 'cloudFolder') ? '' : mapping.remoteTarget

      let content: string | undefined

      switch (platform) {
        case 'github':
          const githubFile = await getGithubFiles({ path: remotePath, repo })
          content = githubFile?.content
          break
        case 'gitee':
          const giteeFile = await getGiteeFiles({ path: remotePath, repo })
          content = giteeFile?.content
          break
        case 'gitlab': {
          const branch = await getGitlabBranch()
          const gitlabFile = await getGitlabFile({ path: remotePath, ref: branch, repo })
          content = gitlabFile?.content
          break
        }
        case 'gitea': {
          const branch = await getGiteaBranch()
          const giteaFile = await getGiteaFile({ path: remotePath, ref: branch, repo })
          content = giteaFile?.content
          break
        }
        case 's3': {
          const s3Config = await getS3Config()
          if (!s3Config) {
            return { success: false, action: 'pull', error: 'S3 配置未找到' }
          }
          s3Config.bucket = mapping.remoteTarget || s3Config.bucket
          // S3 使用相对路径作为 key
          const s3File = await s3Download(s3Config, remotePath)
          if (s3File) {
            content = s3File.content
            // 更新 ETag 记录
            useSyncStore.getState().updateS3FileEtag(path, s3File.etag)
          }
          break
        }
        case 'webdav': {
          const webdavConfig = await getWebDAVConfig()
          if (!webdavConfig) {
            return { success: false, action: 'pull', error: 'WebDAV 配置未找到' }
          }
          webdavConfig.url = mapping.remoteTarget || webdavConfig.url
          const webdavFile = await webdavDownload(webdavConfig, remotePath)
          if (webdavFile) {
            content = webdavFile.content
            // 更新 ETag 记录
            useSyncStore.getState().updateWebDAVFileEtag(path, webdavFile.etag)
          }
          break
        }
        case 'cloudFolder': {
          const config = await getCloudFolderWorkspaceConfig()
          if (!config) {
            return { success: false, action: 'pull', error: '网盘文件夹未配置' }
          }
          config.path = mapping.remoteTarget || config.path
          const cloudFile = await androidCloudFolderWorkspaceDownloadBytes(config, remotePath)
          if (cloudFile) content = new TextDecoder().decode(cloudFile.content)
          break
        }
      }

      if (hasRemoteFileContent(content)) {
        const remoteInfo = await getRemoteFileInfo(path, mapping)
        // S3 和 WebDAV 不需要 base64 解码，其他平台需要
        let decodedContent = content
        if (platform !== 's3' && platform !== 'webdav' && platform !== 'cloudFolder') {
          decodedContent = decodeBase64ToString(content)
        }
        await saveLocalFile(path, decodedContent)

        // 更新兼容 revision 记录和 mapping-scoped 三方基线
        if (remoteInfo.sha) {
          await setLocalRecordedSha(
            path,
            remoteInfo.sha,
            await getSyncMetadataKey(path, mapping),
          )
        }
        await setSyncBaseline(path, mapping, {
          lastLocalContentSha: await calculateFileSha(decodedContent),
          lastRemoteRevision: remoteInfo.sha,
          remoteExists: true,
        })

        await updateFileSyncTime(path)
        await this.logSync(path, 'pull', true)
        return { success: true, action: 'pull', message: '拉取成功', content: decodedContent }
      }

      await this.logSync(path, 'pull', false, '文件不存在')
      return { success: false, action: 'pull', error: '远程文件不存在' }
    } catch (error) {
      await this.logSync(path, 'pull', false, String(error))
      return { success: false, action: 'pull', error: String(error) }
    }
  }

  /**
   * 删除远程文件
   */
  async deleteRemoteFile(path: string, selectedMapping?: ResolvedSyncMapping): Promise<SyncResult> {
    if (shouldExclude(path)) {
      return { success: true, action: 'none', message: '文件被排除在同步之外' }
    }
    try {
      if (!selectedMapping) {
        const writePolicy = await getSyncPathWritePolicy(path)
        if (!writePolicy.writable) {
          return {
            success: false,
            action: 'none',
            error: writePolicy.ambiguous
              ? '当前文件命中多个同步映射，请在连接器中明确选择远端后再删除'
              : '当前映射为只读，不允许删除远端文件',
          }
        }
      }
      const mapping = selectedMapping || await resolvePrimarySyncMapping(path, undefined, 'write')
      if (!mapping) return { success: true, action: 'none', message: '没有匹配的同步映射' }
      if (mapping.accessMode === 'read-only') {
        return { success: false, action: 'none', error: '当前映射为只读，不允许删除远端文件' }
      }
      const platform = mapping.platform
      const remotePath = mapping.remoteFilePath
      const repo = (platform === 's3' || platform === 'webdav' || platform === 'cloudFolder') ? '' : mapping.remoteTarget
      const sha = (platform === 's3' || platform === 'webdav' || platform === 'cloudFolder') ? undefined : await this.getRemoteSha(path, mapping)

      // S3 和 WebDAV 不需要 SHA，但其他平台需要
      if ((platform !== 's3' && platform !== 'webdav' && platform !== 'cloudFolder') && !sha) {
        return { success: true, action: 'none', message: '远程文件不存在，无需删除' }
      }

      let success = false

      switch (platform) {
        case 'github':
          success = !!(await deleteGithubFile({ path: remotePath, sha: sha!, repo }))
          break
        case 'gitee':
          success = !!(await deleteGiteeFile({ path: remotePath, sha: sha!, repo }))
          break
        case 'gitlab':
          success = !!(await deleteGitlabFile({ path: remotePath, sha: sha!, repo }))
          break
        case 'gitea':
          success = !!(await deleteGiteaFile({ path: remotePath, sha: sha!, repo }))
          break
        case 's3': {
          const s3Config = await getS3Config()
          if (!s3Config) {
            return { success: false, action: 'delete', error: 'S3 配置未找到' }
          }
          s3Config.bucket = mapping.remoteTarget || s3Config.bucket
          // S3 使用相对路径作为 key
          success = await s3Delete(s3Config, remotePath)
          if (success) {
            // 移除 ETag 记录
            useSyncStore.getState().removeS3FileEtag(path)
          }
          break
        }
        case 'webdav': {
          const webdavConfig = await getWebDAVConfig()
          if (!webdavConfig) {
            return { success: false, action: 'delete', error: 'WebDAV 配置未找到' }
          }
          webdavConfig.url = mapping.remoteTarget || webdavConfig.url
          success = await webdavDelete(webdavConfig, remotePath)
          if (success) {
            // 移除 ETag 记录
            useSyncStore.getState().removeWebDAVFileEtag(path)
          }
          break
        }
        case 'cloudFolder': {
          const config = await getCloudFolderWorkspaceConfig()
          if (!config) {
            return { success: false, action: 'delete', error: '网盘文件夹未配置' }
          }
          config.path = mapping.remoteTarget || config.path
          success = await androidCloudFolderWorkspaceDelete(config, remotePath)
          break
        }
      }

      if (success) {
        await setSyncBaseline(path, mapping, {
          lastLocalContentSha: await this.getLocalSha(path) || undefined,
          lastRemoteRevision: undefined,
          remoteExists: false,
        })
        await this.logSync(path, 'delete', true)
        return { success: true, action: 'delete', message: '删除成功' }
      }

      await this.logSync(path, 'delete', false, '删除失败')
      return { success: false, action: 'delete', error: '删除失败' }
    } catch (error) {
      await this.logSync(path, 'delete', false, String(error))
      return { success: false, action: 'delete', error: String(error) }
    }
  }

  /**
   * 处理冲突
   */
  async resolveConflict(
    path: string,
    strategy: 'ask' | 'local' | 'remote',
    localContent?: string,
    remoteContent?: string,
    selectedMapping?: ResolvedSyncMapping,
  ): Promise<SyncResult> {
    try {
      // 如果策略是 ask，需要获取用户选择
      if (strategy === 'ask') {
        // 这里会通过 UI 弹窗让用户选择，实际处理在外部
        return { success: false, action: 'conflict', message: '需要用户选择' }
      }

      // 获取内容
      if (!localContent) {
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        try {
          localContent = workspace.isCustom
            ? await readTextFile(pathOptions.path)
            : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        } catch {
          localContent = ''
        }
      }

      if (!remoteContent) {
        remoteContent = await pullRemoteFile(path, selectedMapping)
      }

      switch (strategy) {
        case 'local':
          // 保留本地，删除远程然后重新上传
          {
            const deleteResult = await this.deleteRemoteFile(path, selectedMapping)
            if (!deleteResult.success) return deleteResult
            const pushResult = await this.pushFile(path, localContent, selectedMapping)
            if (!pushResult.success) return pushResult
          }
          toast({ title: '冲突处理', description: '保留本地版本' })
          break
        case 'remote': {
          // 使用远程版本
          await saveLocalFile(path, remoteContent)
          await updateFileSyncTime(path)
          const mapping = selectedMapping || await resolvePrimarySyncMapping(path, undefined, 'read')
          if (mapping) {
            const remoteInfo = await getRemoteFileInfo(path, mapping)
            await setSyncBaseline(path, mapping, {
              lastLocalContentSha: await calculateFileSha(remoteContent),
              lastRemoteRevision: remoteInfo.sha,
              remoteExists: true,
            })
          }
          toast({ title: '冲突处理', description: '使用远程版本' })
          break
        }
      }

      return { success: true, action: 'push', message: '冲突已解决' }
    } catch (error) {
      return { success: false, action: 'conflict', error: String(error) }
    }
  }

  /**
   * 同步单个文件
   */
  async syncFile(path: string, options: {
    onConflict?: (local: string, remote: string) => Promise<'local' | 'remote' | 'cancel'>
  } = {}): Promise<SyncResult> {
    if (shouldExclude(path)) {
      return { success: true, action: 'none', message: '文件被排除在同步之外' }
    }

    // 同一路径只执行一个同步；不同文件可以并行，避免后来的文件被错误地
    // 当成前一个文件的“待同步”并最终丢失。
    if (!this.activeSyncPaths.begin(path)) {
      return { success: true, action: 'none', message: '该文件正在同步' }
    }

    this.state.isSyncing = true

    try {
      const readMapping = await resolvePrimarySyncMapping(path, undefined, 'read')
      const writeMappings = await resolveSyncMappings(path, undefined, 'write')
      const mapping = readMapping
        ?? writeMappings.find(item => item.syncPolicy === 'ignore-remote' && item.accessMode !== 'read-only')
      if (!mapping) return { success: true, action: 'none', message: '没有可用的同步映射' }

      // push-only/ignore-remote 明确跳过远端读取，但仍允许手动与自动推送。
      if (!readMapping && mapping.syncPolicy === 'ignore-remote') {
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        const content = workspace.isCustom
          ? await readTextFile(pathOptions.path)
          : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        const result = await this.pushFile(path, content, mapping)
        if (shouldRecordSuccessfulSync(result)) {
          this.state.lastSyncTime = Date.now()
          this.state.lastSyncSha = await this.getLocalSha(path) || ''
        }
        return result
      }

      // 获取本地和所选远端的 SHA
      const localSha = await this.getLocalSha(path)
      const remoteSha = await this.getRemoteSha(path, mapping)

      // 比较版本
      const syncResult = await compareFileVersions(path, mapping)

      if (syncResult.action === 'none') {
        return { success: true, action: 'none', message: '文件已同步' }
      }

      if (syncResult.action === 'push') {
        // 推送本地版本
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        const content = workspace.isCustom
          ? await readTextFile(pathOptions.path)
          : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })

        const result = await this.pushFile(path, content, mapping)
        if (shouldRecordSuccessfulSync(result)) {
          this.state.lastSyncTime = Date.now()
          this.state.lastSyncSha = localSha || ''
        }
        return result
      }

      if (syncResult.action === 'pull') {
        // 拉取远程版本
        const result = await this.pullFile(path, mapping)
        if (shouldRecordSuccessfulSync(result)) {
          this.state.lastSyncTime = Date.now()
          this.state.lastSyncSha = remoteSha || ''
        }
        return result
      }

      if (syncResult.action === 'conflict' && options.onConflict) {
        // 处理冲突
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        const localContent = workspace.isCustom
          ? await readTextFile(pathOptions.path)
          : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        const remoteContent = await pullRemoteFile(path, mapping)
        const choice = await options.onConflict(localContent, remoteContent)

        if (choice === 'cancel') {
          return { success: false, action: 'conflict', error: '用户取消' }
        }

        return await this.resolveConflict(path, choice, localContent, remoteContent, mapping)
      }

      return { success: true, action: 'none' }
    } finally {
      this.activeSyncPaths.end(path)
      this.state.isSyncing = this.activeSyncPaths.size > 0 || this.processingSyncQueue

      // 保存期间积累的文件使用各自的路径处理，不能复用当前 path。
      if (!this.state.isSyncing && this.syncQueue.size > 0) {
        await this.processSyncQueue()
      } else if (!this.state.isSyncing) {
        this.state.pendingSync = false
      }
    }
  }

  /**
   * 保存时触发推送（带节流）
   */
  async onSave(path: string): Promise<void> {
    if (!this.config.autoSync || !this.config.autoPushOnSave) {
      return
    }
    const mapping = await resolvePrimarySyncMapping(path, undefined, 'write')
    if (!mapping || mapping.accessMode === 'read-only' || mapping.syncMode !== 'automatic') return

    // 检查是否应该排除
    if (shouldExclude(path)) {
      return
    }

    // 标记该路径需要同步（内容从磁盘读取）
    this.syncQueue.set(path, { timestamp: Date.now() })

    // 如果正在同步，标记待同步
    if (this.state.isSyncing) {
      this.state.pendingSync = true
      return
    }

    // 节流 2 秒
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer)
    }

    this.throttleTimer = setTimeout(async () => {
      await this.processSyncQueue()
    }, 2000)
  }

  /**
   * 打开时触发拉取
   * 返回 { updated: true, content: string } 如果拉取了新内容
   */
  async onOpen(path: string): Promise<{ updated: boolean; content?: string } | null> {
    if (!this.config.autoSync || !this.config.autoPullOnOpen) {
      return null
    }

    // 检查是否应该排除
    if (shouldExclude(path)) {
      return null
    }

    const mapping = await resolvePrimarySyncMapping(path, undefined, 'read')
    if (!mapping || !mapping.autoPullOnOpen) return null

    // 比较版本，决定是否需要拉取
    const syncResult = await compareFileVersions(path, mapping)

    if (shouldAutoApplyRemote(syncResult.action)) {
      const result = await this.pullFile(path, mapping)
      if (result.success && result.action === 'pull') {
        return { updated: true, content: result.content }
      }
      return { updated: result.success }
    }

    // 冲突不能自动拉取，否则会无提示覆盖本地修改。
    if (syncResult.action === 'conflict') {
      this.state.syncStatus = 'conflict'
      return { updated: false }
    }

    return null
  }

  /**
   * 处理同步队列
   */
  private async processSyncQueue(): Promise<void> {
    if (this.processingSyncQueue) return
    this.processingSyncQueue = true
    this.state.isSyncing = true

    try {
      for (const [path] of this.syncQueue) {
        // 始终从磁盘读取最新内容，确保上传的是本地最新内容
        const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
        const { readTextFile } = await import('@tauri-apps/plugin-fs')
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)

        let content: string
        if (workspace.isCustom) {
          content = await readTextFile(pathOptions.path)
        } else {
          content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        }

        const mappings = (await resolveSyncMappings(path, undefined, 'write')).filter(mapping => (
          mapping.accessMode !== 'read-only' && mapping.syncMode === 'automatic'
        ))
        const results: SyncResult[] = []
        for (const mapping of mappings) {
          if (mapping.syncPolicy !== 'ignore-remote') {
            const version = await compareFileVersions(path, mapping)
            if (version.action === 'none') {
              results.push({ success: true, action: 'none', message: '文件已同步' })
              continue
            }
            if (version.action !== 'push') {
              results.push({
                success: false,
                action: 'conflict',
                error: version.reason || '远程存在未合并变更，已阻止自动覆盖',
              })
              continue
            }
          }
          results.push(await this.pushFile(path, content, mapping))
        }
        if (mappings.length > 0 && results.every(result => result.success)) {
          this.syncQueue.delete(path)
        }
      }
    } finally {
      this.processingSyncQueue = false
      this.state.isSyncing = this.activeSyncPaths.size > 0
      this.state.pendingSync = this.syncQueue.size > 0
    }
  }

  /**
   * 同步所有文件
   */
  async syncAll(paths: string[]): Promise<SyncResult[]> {
    const results: SyncResult[] = []

    for (const path of paths) {
      const result = await this.syncFile(path)
      results.push(result)
    }

    return results
  }

  /**
   * 记录同步日志
   */
  private async logSync(filePath: string, action: 'push' | 'pull' | 'delete', success: boolean, error?: string): Promise<void> {
    try {
      const store = await Store.load('sync_logs.json')
      const logs = await store.get<SyncLog[]>('logs') || []

      logs.unshift({
        timestamp: Date.now(),
        action,
        filePath,
        success,
        error
      })

      // 只保留最近 100 条
      if (logs.length > 100) {
        logs.splice(100)
      }

      await store.set('logs', logs)
      await store.save()
    } catch {
    }
  }

  /**
   * 获取同步日志
   */
  async getLogs(limit?: number): Promise<SyncLog[]> {
    try {
      const store = await Store.load('sync_logs.json')
      const logs = await store.get<SyncLog[]>('logs') || []
      return limit ? logs.slice(0, limit) : logs
    } catch {
      return []
    }
  }

  /**
   * 清除同步日志
   */
  async clearLogs(): Promise<void> {
    try {
      const store = await Store.load('sync_logs.json')
      await store.set('logs', [])
      await store.save()
    } catch {
    }
  }

  /**
   * 获取文件的同步状态
   */
  async getFileSyncStatus(path: string): Promise<SyncState['syncStatus']> {
    const mapping = await resolvePrimarySyncMapping(path, undefined, 'read')
    const localSha = await this.getLocalSha(path)
    const remoteSha = mapping ? await this.getRemoteSha(path, mapping) : null

    if (!localSha && !remoteSha) {
      return 'unknown'
    }

    if (!localSha) {
      return 'remote_newer'
    }

    if (!remoteSha) {
      return 'local_newer'
    }

    if (localSha === remoteSha) {
      return 'synced'
    }

    return 'conflict'
  }
}

// 单例实例
let syncManager: SyncManager | null = null

export function getSyncManager(): SyncManager {
  if (!syncManager) {
    syncManager = new SyncManager()
  }
  return syncManager
}

// 便捷函数
export async function syncOnSave(path: string): Promise<void> {
  const manager = getSyncManager()
  await manager.onSave(path)
}

export async function syncOnOpen(path: string): Promise<{ updated: boolean; content?: string } | null> {
  const manager = getSyncManager()
  return await manager.onOpen(path)
}

export async function syncSingleFile(path: string, onConflict?: (local: string, remote: string) => Promise<'local' | 'remote' | 'cancel'>): Promise<SyncResult> {
  const manager = getSyncManager()
  return await manager.syncFile(path, { onConflict })
}

function hasConfiguredText(value: string | null | undefined): boolean {
  return Boolean(value?.trim())
}

/**
 * 检查同步是否已配置
 * 检查是否有选择同步平台并配置了对应的访问令牌
 */
export async function isSyncConfigured(): Promise<boolean> {
  try {
    const store = await Store.load('store.json')
    const platform = await store.get<string>('primaryBackupMethod') || 'github'

    // 检查对应平台的访问令牌（确保不是空字符串）
    switch (platform) {
      case 'github': {
        const token = await store.get<string>('accessToken')
        const username = await store.get<string>('githubUsername')
        const repo = await getOptionalSyncRepoName('github')
        return hasConfiguredText(token) && hasConfiguredText(username) && hasConfiguredText(repo)
      }
      case 'gitee': {
        const giteeToken = await store.get<string>('giteeAccessToken')
        const giteeUsername = await store.get<string>('giteeUsername')
        const repo = await getOptionalSyncRepoName('gitee')
        return hasConfiguredText(giteeToken) && hasConfiguredText(giteeUsername) && hasConfiguredText(repo)
      }
      case 'gitlab': {
        const gitlabToken = await store.get<string>('gitlabAccessToken')
        const gitlabUsername = await store.get<string>('gitlabUsername')
        const repo = await getOptionalSyncRepoName('gitlab')
        const projectId = await store.get<string>(`gitlab_${repo}_project_id`)
        const instanceType = await store.get<string>('gitlabInstanceType')
        const customUrl = await store.get<string>('gitlabCustomUrl')
        const instanceConfigured = instanceType !== 'self-hosted' || hasConfiguredText(customUrl)

        return hasConfiguredText(gitlabToken) &&
          hasConfiguredText(gitlabUsername) &&
          hasConfiguredText(repo) &&
          hasConfiguredText(projectId) &&
          instanceConfigured
      }
      case 'gitea': {
        const giteaToken = await store.get<string>('giteaAccessToken')
        const giteaUsername = await store.get<string>('giteaUsername')
        const repo = await getOptionalSyncRepoName('gitea')
        const instanceType = await store.get<string>('giteaInstanceType')
        const customUrl = await store.get<string>('giteaCustomUrl')
        const instanceConfigured = instanceType !== 'self-hosted' || hasConfiguredText(customUrl)

        return hasConfiguredText(giteaToken) &&
          hasConfiguredText(giteaUsername) &&
          hasConfiguredText(repo) &&
          instanceConfigured
      }
      case 's3': {
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        return Boolean(s3Config) &&
          hasConfiguredText(s3Config?.accessKeyId) &&
          hasConfiguredText(s3Config?.secretAccessKey) &&
          hasConfiguredText(s3Config?.region) &&
          hasConfiguredText(s3Config?.bucket)
      }
      case 'webdav': {
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
        return Boolean(webdavConfig) &&
          hasConfiguredText(webdavConfig?.url) &&
          hasConfiguredText(webdavConfig?.username) &&
          hasConfiguredText(webdavConfig?.password)
      }
      case 'cloudFolder': {
        const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
        return Boolean(config && supportsCloudFolderWorkspace(config))
      }
      default:
        return false
    }
  } catch {
    return false
  }
}
