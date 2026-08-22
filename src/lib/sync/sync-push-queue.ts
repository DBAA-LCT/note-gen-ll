'use client'

import { Store } from '@tauri-apps/plugin-store'
import { getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { readTextFile } from '@tauri-apps/plugin-fs'
import emitter from '@/lib/emitter'
import {
  calculateFileSha,
  compareFileVersions,
  pullRemoteFile,
  setLocalRecordedSha,
  getLocalRecordedSha,
  getRemoteFileInfo,
} from './auto-sync'
import useSettingStore from '@/stores/setting'
import useSyncStore from '@/stores/sync'
import { CloudFolderConfig, S3Config, WebDAVConfig } from '@/types/sync'
import { debugSyncPerf } from './remote-file'
import { generateGitSyncCommitMessage } from './commit-message'
import { getSyncMetadataKey } from './sync-context'
import { getSyncBaseline, setSyncBaseline } from './sync-baseline'
import { supportsCloudFolderWorkspace } from './cloud-folder'
import {
  resolveSyncMappings,
  type ResolvedSyncMapping,
} from './connector-mappings'

type SyncProvider = 'gitee' | 'github' | 'gitlab' | 'gitea' | 's3' | 'webdav' | 'cloudFolder'
type SyncMappingIdentity = Pick<ResolvedSyncMapping, 'id' | 'platform' | 'remoteTarget' | 'remoteFilePath'>
type SyncErrorKind = 'conflict' | 'transient' | 'permanent'

function getMappingIdentity(mapping: ResolvedSyncMapping): SyncMappingIdentity {
  return {
    id: mapping.id,
    platform: mapping.platform,
    remoteTarget: mapping.remoteTarget,
    remoteFilePath: mapping.remoteFilePath,
  }
}

function classifySyncError(error: unknown): SyncErrorKind {
  const value = error as { status?: number; response?: { status?: number }; message?: string }
  const status = value?.status || value?.response?.status || 0
  const message = (value?.message || String(error)).toLowerCase()
  const revisionConflict = status === 409
    || status === 412
    || (status === 422 && /(sha|revision|blob|commit|out of date|conflict|冲突|过时)/i.test(message))
    || /(revision|last_commit_id|does not match|out of date|remote file.*变化|远程文件已变化)/i.test(message)
  if (revisionConflict) return 'conflict'
  if ([408, 425, 429].includes(status) || status >= 500) return 'transient'
  if (status >= 400 && status < 500) return 'permanent'
  if (/(timeout|timed out|network|fetch failed|connection|econn|socket|temporar)/i.test(message)) return 'transient'
  return 'permanent'
}

async function getCloudFolderWorkspaceConfig(): Promise<CloudFolderConfig | null> {
  const store = await Store.load('store.json')
  const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
  return config && supportsCloudFolderWorkspace(config) ? { ...config } : null
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

/**
 * 获取代理配置
 */
async function getProxyConfig(): Promise<{ all: string } | undefined> {
  const store = await Store.load('store.json')
  const proxyUrl = await store.get<string>('proxy')
  return proxyUrl ? { all: proxyUrl } : undefined
}

interface PushTask {
  path: string
  timestamp: number
  workspacePath: string
  generation: number
  retryCount: number
  notBefore: number
}

function getPerfNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function roundMs(value: number) {
  return Math.round(value)
}

// 使用模块级变量来跟踪初始化状态，避免 HMR 重复注册
let initialized = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let articleSavedListener: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let editorInputListener: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let syncPulledListener: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let articleOpenedListener: any = null

class SyncPushQueue {
  private queue: PushTask[] = []
  private isProcessing = false
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private lastInputTime: number = Date.now()
  private generation = 0
  private workspaceSwitchPauseDepth = 0
  private readonly WORKSPACE_SWITCH_WAIT_TIMEOUT = 3_000
  private readonly MAX_REQUEUE_ATTEMPTS = 4
  private readonly RETRY_BASE_DELAY = 500

  private get IDLE_THRESHOLD(): number {
    // 动态读取 autoSync 设置
    const state = useSettingStore.getState()
    if (!state) return 0

    const { autoSync } = state

    if (!autoSync || autoSync === 'disabled') {
      return 0 // 禁用自动同步
    }
    return parseInt(autoSync, 10) * 1000
  }

  private readonly CHECK_INTERVAL = 100 // 每 100ms 检查一次

  /**
   * 初始化监听器 - 只执行一次
   */
  init() {
    if (initialized) return
    initialized = true
    this.initListeners()
  }

  private initListeners() {
    // 移除旧的监听器（如果有）
    this.removeListeners()

    // 监听文章保存事件
    articleSavedListener = ((event: { path: string; content: string }) => {
      this.addTask(event.path)
    }) as any
    emitter.on('article-saved', articleSavedListener)

    // 监听用户输入事件，重置计时器
    editorInputListener = (() => {
      this.lastInputTime = Date.now()
    }) as any
    emitter.on('editor-input', editorInputListener)

    // 监听拉取完成事件，重置计时器
    syncPulledListener = (() => {
      this.lastInputTime = Date.now()
    }) as any
    emitter.on('sync-pulled', syncPulledListener)

    // 监听文件切换事件，重置计时器
    articleOpenedListener = (() => {
      this.lastInputTime = Date.now()
    }) as any
    emitter.on('article-opened', articleOpenedListener)
  }

  private removeListeners() {
    if (articleSavedListener) {
      emitter.off('article-saved', articleSavedListener)
    }
    if (editorInputListener) {
      emitter.off('editor-input', editorInputListener)
    }
    if (syncPulledListener) {
      emitter.off('sync-pulled', syncPulledListener)
    }
    if (articleOpenedListener) {
      emitter.off('article-opened', articleOpenedListener)
    }
    articleSavedListener = null
    editorInputListener = null
    syncPulledListener = null
    articleOpenedListener = null
  }

  /**
   * 添加任务到队列：仅合并同一 workspace+path，保留其他文件任务。
   * 每次调用都会重新开始空闲计时。
   */
  addTask(path: string) {
    if (this.workspaceSwitchPauseDepth > 0) return

    const now = Date.now()
    const task: PushTask = {
      path,
      timestamp: now,
      workspacePath: useSettingStore.getState().workspacePath,
      generation: this.generation,
      retryCount: 0,
      notBefore: now,
    }

    // 重置 lastInputTime，确保从现在开始计算 10 秒
    this.lastInputTime = now

    // 仅合并同一 workspace+path 的旧任务，绝不覆盖其他文件。
    this.queue = this.queue.filter(existing => !(
      existing.workspacePath === task.workspacePath && existing.path === task.path
    ))
    this.queue.push(task)

    if (this.isProcessing) return

    // 设置防抖定时器
    this.scheduleFlush()
  }

  /**
   * 防抖调度 - 用户停止输入后执行推送
   */
  private scheduleFlush() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    const checkIdle = () => {
      const now = Date.now()
      const timeSinceInput = now - this.lastInputTime

      if (timeSinceInput >= (this.IDLE_THRESHOLD || 10000)) {
        // 用户停止输入超过等待时间，执行推送
        this.flush()
      } else {
        // 继续等待
        this.debounceTimer = setTimeout(checkIdle, this.CHECK_INTERVAL)
      }
    }

    this.debounceTimer = setTimeout(checkIdle, this.CHECK_INTERVAL)
  }

  /**
   * 清空队列并处理任务
   * Bug fix: Process all tasks in the queue, not just the last one
   */
  private async flush() {
    if (this.isProcessing || this.queue.length === 0) {
      return
    }

    // Bug fix: Process all tasks in the queue (newest first)
    // Group by path - keep only the newest task for each path
    const taskMap = new Map<string, PushTask>()
    const queuedTasks = this.queue
    this.queue = []
    for (const task of queuedTasks) {
      if (task.generation !== this.generation) continue
      if (task.notBefore > Date.now()) {
        this.queue.push(task)
        continue
      }
      // Only keep the newest task for each path
      const taskKey = `${task.workspacePath}\0${task.path}`
      const existing = taskMap.get(taskKey)
      if (!existing || task.timestamp > existing.timestamp) {
        taskMap.set(taskKey, task)
      }
    }
    const tasksToProcess = Array.from(taskMap.values()).sort((a, b) => b.timestamp - a.timestamp)

    this.isProcessing = false // Will be set to true in the loop

    // Process each task
    for (const task of tasksToProcess) {
      if (task.generation !== this.generation) continue
      if (task.workspacePath !== useSettingStore.getState().workspacePath) continue
      this.isProcessing = true

      try {
        // Wait for file system to complete write
        await new Promise(resolve => setTimeout(resolve, 100))
        // 发送开始推送事件
        emitter.emit('sync-push-started', { path: task.path })
        const result = await this.pushToRemote(task.path, task)
        if (!result.success && result.retryable !== false) this.requeueFailedTask(task)
      } catch (error) {
        console.error(`[SyncPushQueue] Failed to push ${task.path}:`, error)
        this.requeueFailedTask(task)
      } finally {
        this.isProcessing = false
      }
    }

    // Schedule if there are new tasks
    if (this.queue.length > 0) {
      this.scheduleFlush()
    }
  }

  /**
   * 推送到远程仓库
   */
  private requeueFailedTask(task: PushTask) {
    if (!this.isTaskCurrent(task) || task.retryCount >= this.MAX_REQUEUE_ATTEMPTS) return
    const retryCount = task.retryCount + 1
    const retryTask: PushTask = {
      ...task,
      retryCount,
      notBefore: Date.now() + Math.min(this.RETRY_BASE_DELAY * 2 ** (retryCount - 1), 8_000),
    }
    const hasNewerTask = this.queue.some(existing => (
      existing.workspacePath === task.workspacePath
      && existing.path === task.path
      && existing.timestamp >= task.timestamp
    ))
    if (!hasNewerTask) this.queue.push(retryTask)
  }

  private isTaskCurrent(task: PushTask) {
    return task.generation === this.generation
      && task.workspacePath === useSettingStore.getState().workspacePath
      && this.workspaceSwitchPauseDepth === 0
  }

  private async pushToRemote(
    path: string,
    task: PushTask,
    selectedMapping?: ResolvedSyncMapping,
  ): Promise<{ success: boolean; sha?: string; retryable?: boolean }> {
    if (!selectedMapping) {
      const mappings = (await resolveSyncMappings(path, undefined, 'write')).filter(mapping => (
        mapping.accessMode !== 'read-only' && mapping.syncMode === 'automatic'
      ))
      if (mappings.length > 1) {
        const results = []
        for (const mapping of mappings) results.push(await this.pushToRemote(path, task, mapping))
        return {
          success: results.every(result => result.success),
          sha: results.find(result => result.sha)?.sha,
          retryable: results
            .filter(result => !result.success)
            .some(result => result.retryable !== false),
        }
      }
      selectedMapping = mappings[0]
    }
    const mapping = selectedMapping
    if (!mapping || mapping.accessMode === 'read-only' || mapping.syncMode !== 'automatic') {
      return { success: false, retryable: false }
    }
    const remotePath = mapping.remoteFilePath
    const maxRetries = 1
    const syncStartedAt = getPerfNow()
    let previousPerfAt = syncStartedAt
    let providerForLog: SyncProvider | 'unknown' = 'unknown'
    const logPerf = (step: string, payload: Record<string, unknown> = {}) => {
      const now = getPerfNow()
      debugSyncPerf(`syncQueue.${step}`, {
        path,
        provider: providerForLog,
        stepMs: roundMs(now - previousPerfAt),
        totalMs: roundMs(now - syncStartedAt),
        ...payload,
      })
      previousPerfAt = now
    }

    const taskSyncMetadataKey = await getSyncMetadataKey(path, mapping)
    const expectedRemoteRevision = (await getSyncBaseline(path, mapping))?.lastRemoteRevision
    if (!this.isTaskCurrent(task)) return { success: false }

    if (mapping.syncPolicy !== 'ignore-remote') {
      const version = await compareFileVersions(path, mapping)
      if (version.action === 'none') {
        const remoteInfo = await getRemoteFileInfo(path, mapping)
        emitter.emit('sync-push-completed', { path, success: true, sha: remoteInfo.sha })
        return { success: true, sha: remoteInfo.sha }
      }
      if (version.action !== 'push') {
        const remoteInfo = await getRemoteFileInfo(path, mapping)
        emitter.emit('sync-sha-mismatch', {
          path,
          workspacePath: task.workspacePath,
          localSha: await getLocalRecordedSha(path, mapping) || undefined,
          remoteSha: remoteInfo.sha,
          force: false,
          mapping: getMappingIdentity(mapping),
        })
        emitter.emit('sync-push-completed', { path, success: false })
        return { success: false, retryable: false }
      }
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!this.isTaskCurrent(task)) return { success: false }
        logPerf('startAttempt', {
          attempt,
          maxRetries,
        })
        const provider = mapping.platform as SyncProvider
        providerForLog = provider
        const repo = (provider !== 's3' && provider !== 'webdav' && provider !== 'cloudFolder')
          ? mapping.remoteTarget
          : undefined
        logPerf('loadConfig', {
          attempt,
          hasRepo: Boolean(repo),
        })

        // 从磁盘读取最新内容，确保上传的是本地最新内容
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        const content = workspace.isCustom
          ? await readTextFile(pathOptions.path)
          : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        logPerf('readLocalFile', {
          attempt,
          workspaceCustom: workspace.isCustom,
          contentLength: content.length,
        })

        // 先显式查询存在性；查询异常必须中止，不能被当成 not-found 后覆盖远端。
        const currentRemoteInfo = mapping.syncPolicy === 'ignore-remote'
          ? { exists: false as const, sha: undefined }
          : await getRemoteFileInfo(path, mapping)
        if (currentRemoteInfo.exists) {
          const remoteContent = await pullRemoteFile(path, mapping)
          logPerf('pullRemoteFile', {
            attempt,
            remoteLength: remoteContent.length,
            isSameContent: remoteContent === content,
          })
          if (remoteContent === content) {
            if (!this.isTaskCurrent(task)) return { success: false }
            const remoteSha = currentRemoteInfo.sha
            if (!this.isTaskCurrent(task)) return { success: false }
            logPerf('getRemoteShaWhenSame', {
              attempt,
              hasSha: Boolean(remoteSha),
            })
            if (remoteSha) {
              await setLocalRecordedSha(path, remoteSha, taskSyncMetadataKey)
              logPerf('recordLocalSha', {
                attempt,
                hasSha: true,
              })
            }
            await setSyncBaseline(path, mapping, {
              lastLocalContentSha: await calculateFileSha(content),
              lastRemoteRevision: remoteSha,
              remoteExists: true,
            })
            emitter.emit('sync-push-completed', { path, success: true, sha: remoteSha })
            logPerf('completed', {
              attempt,
              skippedUpload: true,
              success: true,
              hasSha: Boolean(remoteSha),
            })
            return { success: true, sha: remoteSha }
          }
        }

        const needsCommitMessage = provider !== 's3' && provider !== 'webdav' && provider !== 'cloudFolder'
        const commitMessage = needsCommitMessage
          ? await generateGitSyncCommitMessage(path, content)
          : ''
        if (needsCommitMessage) {
          logPerf('generateCommitMessage', {
            attempt,
            messageLength: commitMessage.length,
            thinkingDisabled: true,
          })
        } else {
          logPerf('skipCommitMessage', {
            attempt,
            reason: 'provider-without-commits',
          })
        }

        if (!this.isTaskCurrent(task)) return { success: false }

        let success = false
        let uploadedSha: string | undefined

        switch (provider) {
          case 'github': {
            const githubModule = await import('@/lib/sync/github') as any
            logPerf('loadProviderModule', { attempt, module: 'github' })
            // 每次尝试都重新获取远程 SHA，因为远程可能在变化
            const fileInfo = await githubModule.getFiles({ path: remotePath, repo })
            logPerf('getRemoteFile', {
              attempt,
              isDirectory: Array.isArray(fileInfo),
              hasRemoteSha: Boolean(fileInfo?.sha),
            })

            // 检查返回的是文件还是目录
            // GitHub API 对文件返回对象，对目录返回数组
            // 如果是数组（目录），则无法获取 sha，跳过推送
            if (Array.isArray(fileInfo)) {
              console.warn(`[SyncPushQueue] ${path} 是目录，无法推送`)
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'remote-is-directory',
              })
              return { success: false, retryable: false }
            }

            const result = await githubModule.uploadFile({
              ext: path.split('.').pop() || 'md',
              file: content,
              filename: path.split('/').pop() || path,
              sha: expectedRemoteRevision || fileInfo?.sha,
              message: commitMessage,
              repo,
              path: remotePath
            })
            logPerf('uploadFile', {
              attempt,
              hasData: Boolean(result?.data),
              hasResultSha: Boolean(result?.data?.content?.sha),
            })
            // 检查上传是否成功（result 必须存在且有 data）
            if (result && result.data) {
              success = true
              uploadedSha = result?.data?.content?.sha || fileInfo?.sha
            }
            break
          }
          case 'gitee': {
            const giteeModule = await import('@/lib/sync/gitee') as any
            logPerf('loadProviderModule', { attempt, module: 'gitee' })
            // 每次尝试都重新获取远程 SHA
            const fileInfo = await giteeModule.getFiles({ path: remotePath, repo})
            logPerf('getRemoteFile', {
              attempt,
              isDirectory: Array.isArray(fileInfo),
              hasRemoteSha: Boolean(fileInfo?.sha),
            })

            // 检查返回的是文件还是目录
            // Gitee API 对文件返回对象，对目录返回数组
            // 如果是数组（目录），则无法获取 sha，跳过推送
            if (Array.isArray(fileInfo)) {
              console.warn(`[SyncPushQueue] ${path} 是目录，无法推送`)
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'remote-is-directory',
              })
              return { success: false, retryable: false }
            }

            const result = await giteeModule.uploadFile({
              ext: path.split('.').pop() || 'md',
              file: content,
              filename: path.split('/').pop() || path,
              sha: expectedRemoteRevision || fileInfo?.sha,
              message: commitMessage,
              repo,
              path: remotePath
            })
            logPerf('uploadFile', {
              attempt,
              hasData: Boolean(result?.data),
              hasResultSha: Boolean(result?.data?.content?.sha),
            })
            // 检查上传是否成功
            if (result && result.data) {
              success = true
              // Gitee API 返回的是 result.data.content.sha
              uploadedSha = result?.data?.content?.sha || fileInfo?.sha
            }
            break
          }
          case 'gitlab': {
            const gitlabModule = await import('@/lib/sync/gitlab') as any
            logPerf('loadProviderModule', { attempt, module: 'gitlab' })
            // 先获取远程文件的 SHA（blob_id），uploadFile 会用它获取 last_commit_id
            const fileInfo = await gitlabModule.getFiles({ path: remotePath, repo })
            logPerf('getRemoteFile', {
              attempt,
              isDirectory: Array.isArray(fileInfo),
              hasRemoteSha: Boolean(fileInfo?.sha),
            })
            // GitLab getFiles 返回文件对象或文件数组，检查是否为数组（目录）
            if (Array.isArray(fileInfo)) {
              console.warn(`[SyncPushQueue] ${path} 是目录，无法推送`)
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'remote-is-directory',
              })
              return { success: false, retryable: false }
            }
            const result = await gitlabModule.uploadFile({
              file: content,
              filename: path.split('/').pop() || path,
              sha: expectedRemoteRevision || fileInfo?.sha, // GitLab provider uses this as an update marker
              message: commitMessage,
              repo,
              path: remotePath
            })
            logPerf('uploadFile', {
              attempt,
              hasData: Boolean(result?.data),
            })
            // 检查上传是否成功
            if (result && result.data) {
              success = true
              // GitLab 上传成功后从 commit 获取 SHA
              uploadedSha = await this.getRemoteSha(path, mapping)
              logPerf('refreshUploadedSha', {
                attempt,
                hasSha: Boolean(uploadedSha),
              })
            }
            break
          }
          case 'gitea': {
            const giteaModule = await import('@/lib/sync/gitea') as any
            logPerf('loadProviderModule', { attempt, module: 'gitea' })
            // 先获取远程文件的 SHA
            const fileInfo = await giteaModule.getFiles({ path: remotePath, repo })
            logPerf('getRemoteFile', {
              attempt,
              isDirectory: Array.isArray(fileInfo),
              hasRemoteSha: Boolean(fileInfo?.sha),
            })
            // Gitea getFiles 返回文件对象或文件数组，检查是否为数组（目录）
            if (Array.isArray(fileInfo)) {
              console.warn(`[SyncPushQueue] ${path} 是目录，无法推送`)
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'remote-is-directory',
              })
              return { success: false, retryable: false }
            }
            const result = await giteaModule.uploadFile({
              file: content,
              filename: path.split('/').pop() || path,
              sha: expectedRemoteRevision || fileInfo?.sha, // 基线 SHA 用作条件更新
              message: commitMessage,
              repo,
              path: remotePath
            })
            logPerf('uploadFile', {
              attempt,
              hasData: Boolean(result?.data),
            })
            // 检查上传是否成功
            if (result && result.data) {
              success = true
              // Gitea 上传成功后从 commit 获取 SHA
              uploadedSha = await this.getRemoteSha(path, mapping)
              logPerf('refreshUploadedSha', {
                attempt,
                hasSha: Boolean(uploadedSha),
              })
            }
            break
          }
          case 's3': {
            const s3Module = await import('@/lib/sync/s3') as any
            const s3Config = await getS3Config()
            if (s3Config) s3Config.bucket = mapping.remoteTarget || s3Config.bucket
            logPerf('loadProviderModule', { attempt, module: 's3', hasConfig: Boolean(s3Config) })
            if (!s3Config) {
              console.warn('[SyncPushQueue] S3 未配置')
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'missing-config',
              })
              return { success: false, retryable: false }
            }

            // 获取代理配置
            const proxy = await getProxyConfig()
            logPerf('loadProxyConfig', {
              attempt,
              hasProxy: Boolean(proxy),
            })

            // S3 条件写
            const result = await s3Module.s3Upload(
              s3Config,
              remotePath,
              content,
              proxy,
              'text/markdown; charset=utf-8',
              mapping.syncPolicy === 'ignore-remote'
                ? { throwOnError: true }
                : {
                    throwOnError: true,
                    ifMatch: currentRemoteInfo.exists ? expectedRemoteRevision || currentRemoteInfo.sha : undefined,
                    ifNoneMatch: !currentRemoteInfo.exists,
                  },
            )
            logPerf('uploadFile', {
              attempt,
              hasResult: Boolean(result),
              hasEtag: Boolean(result?.etag),
            })
            if (result) {
              success = true
              uploadedSha = result.etag || undefined // 使用 ETag 作为标识
              // 更新本地记录的 ETag
              if (this.isTaskCurrent(task)) {
                useSyncStore.getState().updateS3FileEtag(path, result.etag)
              }
            }
            break
          }
          case 'webdav': {
            const webdavModule = await import('@/lib/sync/webdav') as any
            const webdavConfig = await getWebDAVConfig()
            if (webdavConfig) webdavConfig.url = mapping.remoteTarget || webdavConfig.url
            logPerf('loadProviderModule', { attempt, module: 'webdav', hasConfig: Boolean(webdavConfig) })
            if (!webdavConfig) {
              console.warn('[SyncPushQueue] WebDAV 未配置')
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'missing-config',
              })
              return { success: false, retryable: false }
            }

            // 获取代理配置
            const proxy = await getProxyConfig()
            logPerf('loadProxyConfig', {
              attempt,
              hasProxy: Boolean(proxy),
            })

            // WebDAV 条件写
            const result = await webdavModule.webdavUpload(
              webdavConfig,
              remotePath,
              content,
              proxy,
              'text/markdown; charset=utf-8',
              mapping.syncPolicy === 'ignore-remote'
                ? { throwOnError: true }
                : {
                    throwOnError: true,
                    ifMatch: currentRemoteInfo.exists ? expectedRemoteRevision || currentRemoteInfo.sha : undefined,
                    ifNoneMatch: !currentRemoteInfo.exists,
                  },
            )
            logPerf('uploadFile', {
              attempt,
              hasResult: Boolean(result),
              hasEtag: Boolean(result?.etag),
            })
            if (result) {
              success = true
              uploadedSha = result.etag || undefined // 使用 ETag 作为标识，空字符串使用默认值
              // 更新本地记录的 ETag
              if (this.isTaskCurrent(task)) {
                useSyncStore.getState().updateWebDAVFileEtag(path, result.etag || '')
              }
            }
            break
          }
          case 'cloudFolder': {
            const config = await getCloudFolderWorkspaceConfig()
            if (config) config.path = mapping.remoteTarget || config.path
            if (!config) {
              emitter.emit('sync-push-completed', { path, success: false })
              return { success: false, retryable: false }
            }
            const { androidCloudFolderWorkspaceUpload } = await import('@/lib/sync/cloud-folder')
            const result = await androidCloudFolderWorkspaceUpload(config, remotePath, content)
            success = true
            uploadedSha = result.etag
            break
          }
        }

        if (success) {
          if (!this.isTaskCurrent(task)) {
            emitter.emit('sync-push-completed', { path, success: false })
            return { success: false }
          }
          // 推送成功后，保存 scoped revision 和三方同步基线
          const remoteRevision = uploadedSha || await this.getRemoteSha(path, mapping)
          if (remoteRevision) {
            await setLocalRecordedSha(path, remoteRevision, taskSyncMetadataKey)
            logPerf('recordLocalSha', {
              attempt,
              hasSha: true,
            })
          }
          await setSyncBaseline(path, mapping, {
            lastLocalContentSha: await calculateFileSha(content),
            lastRemoteRevision: remoteRevision,
            remoteExists: true,
          })
          emitter.emit('sync-push-completed', { path, success: true, sha: uploadedSha })
          logPerf('completed', {
            attempt,
            success: true,
            hasSha: Boolean(uploadedSha),
          })
          return { success: true, sha: uploadedSha }
        } else {
          // 上传失败（result 为空或无效）
          emitter.emit('sync-push-completed', { path, success: false })
          logPerf('completed', {
            attempt,
            success: false,
            reason: 'empty-upload-result',
          })
          return { success: false, retryable: true }
        }
      } catch (error: any) {
        if (!this.isTaskCurrent(task)) return { success: false }
        logPerf('failedAttempt', {
          attempt,
          message: error instanceof Error ? error.message : String(error),
          status: error?.status,
        })
        const classification = classifySyncError(error)
        if (classification === 'conflict') {
          const localRecordedSha = await getLocalRecordedSha(path, mapping)
          const remoteFileInfo = await getRemoteFileInfo(path, mapping)
          logPerf('revisionConflict', {
            attempt,
            hasLocalSha: Boolean(localRecordedSha),
            hasRemoteSha: Boolean(remoteFileInfo.sha),
          })
          emitter.emit('sync-sha-mismatch', {
            path,
            workspacePath: task.workspacePath,
            localSha: localRecordedSha || undefined,
            remoteSha: remoteFileInfo.sha || undefined,
            force: false,
            mapping: getMappingIdentity(mapping),
          })
          emitter.emit('sync-push-completed', { path, success: false })
          return { success: false, retryable: false }
        }

        if (classification === 'transient' && attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt - 1) * 500 + Math.floor(Math.random() * 200)
          logPerf('retryWait', { attempt, waitMs: waitTime })
          await new Promise(resolve => setTimeout(resolve, waitTime))
          continue
        }

        console.error('[SyncPushQueue] 推送失败:', error)
        emitter.emit('sync-push-completed', { path, success: false })
        logPerf('completed', { attempt, success: false, reason: classification })
        return { success: false, retryable: classification === 'transient' }
      }
    }

    return { success: false, retryable: false }
  }

  /**
   * 获取远程文件的 SHA
   */
  private async getRemoteSha(
    path: string,
    mapping: ResolvedSyncMapping,
  ): Promise<string | undefined> {
    const info = await getRemoteFileInfo(path, mapping)
    return info.sha
  }

  /**
   * 强制推送文件到远程（忽略 SHA 不匹配）
   * 用于用户确认后强制覆盖远程文件
   */
  async forcePush(
    path: string,
    expectedWorkspacePath = useSettingStore.getState().workspacePath,
    mappingIdentity?: SyncMappingIdentity,
  ): Promise<{ success: boolean; sha?: string }> {
    try {
      const mappings = await resolveSyncMappings(path, undefined, 'write')
      const mapping = mappingIdentity
        ? mappings.find(item => (
            item.id === mappingIdentity.id
            && item.platform === mappingIdentity.platform
            && item.remoteTarget === mappingIdentity.remoteTarget
            && item.remoteFilePath === mappingIdentity.remoteFilePath
          ))
        : mappings.length === 1 ? mappings[0] : undefined
      if (!mapping || mapping.accessMode === 'read-only') return { success: false }
      const remotePath = mapping.remoteFilePath
      if (
        this.workspaceSwitchPauseDepth > 0
        || expectedWorkspacePath !== useSettingStore.getState().workspacePath
      ) {
        return { success: false }
      }

      const provider = mapping.platform as SyncProvider
      const repo = (provider !== 's3' && provider !== 'webdav' && provider !== 'cloudFolder')
        ? mapping.remoteTarget
        : undefined

      // 从磁盘读取最新内容
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(path)
      const content = workspace.isCustom
        ? await readTextFile(pathOptions.path)
        : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })

      const needsCommitMessage = provider !== 's3' && provider !== 'webdav' && provider !== 'cloudFolder'
      const commitMessage = needsCommitMessage
        ? await generateGitSyncCommitMessage(path, content)
        : ''

      let success = false
      let uploadedSha: string | undefined
      // “强制”只跳过本地基线冲突提示；实际更新仍使用刚读取的远端 revision，
      // 防止确认后到写入前发生的第三方修改被静默覆盖。
      const currentRemoteInfo = await getRemoteFileInfo(path, mapping)

      switch (provider) {
        case 'github': {
          const githubModule = await import('@/lib/sync/github') as any
          // 强制上传：不带 sha 参数
          const result = await githubModule.uploadFile({
            ext: path.split('.').pop() || 'md',
            file: content,
            filename: path.split('/').pop() || path,
            sha: currentRemoteInfo.sha,
            message: commitMessage,
            repo,
            path: remotePath
          })
          if (result && result.data) {
            success = true
            uploadedSha = result?.data?.content?.sha
          }
          break
        }
        case 'gitee': {
          const giteeModule = await import('@/lib/sync/gitee') as any
          const result = await giteeModule.uploadFile({
            ext: path.split('.').pop() || 'md',
            file: content,
            filename: path.split('/').pop() || path,
            sha: currentRemoteInfo.sha,
            message: commitMessage,
            repo,
            path: remotePath
          })
          if (result && result.data) {
            success = true
            // Gitee API 返回的是 result.data.content.sha
            uploadedSha = result?.data?.content?.sha
          }
          break
        }
        case 'gitlab': {
          const gitlabModule = await import('@/lib/sync/gitlab') as any
          await gitlabModule.uploadFile({
            file: content,
            filename: path.split('/').pop() || path,
            sha: currentRemoteInfo.sha,
            message: commitMessage,
            repo,
            path: remotePath
          })
          success = true
          uploadedSha = await this.getRemoteSha(path, mapping)
          break
        }
        case 'gitea': {
          const giteaModule = await import('@/lib/sync/gitea') as any
          await giteaModule.uploadFile({
            file: content,
            filename: path.split('/').pop() || path,
            sha: currentRemoteInfo.sha,
            message: commitMessage,
            repo,
            path: remotePath
          })
          success = true
          uploadedSha = await this.getRemoteSha(path, mapping)
          break
        }
        case 's3': {
          const s3Module = await import('@/lib/sync/s3') as any
          const s3Config = await getS3Config()
          if (s3Config) s3Config.bucket = mapping.remoteTarget || s3Config.bucket
          if (!s3Config) {
            console.warn('[SyncPushQueue] S3 未配置')
            emitter.emit('sync-push-completed', { path, success: false })
            return { success: false }
          }

          // 获取代理配置
          const proxy = await getProxyConfig()

          const result = await s3Module.s3Upload(
            s3Config,
            remotePath,
            content,
            proxy,
            'text/markdown; charset=utf-8',
            {
              throwOnError: true,
              ifMatch: currentRemoteInfo.exists ? currentRemoteInfo.sha : undefined,
              ifNoneMatch: !currentRemoteInfo.exists,
            },
          )
          if (result) {
            success = true
            uploadedSha = result.etag || undefined
            // 更新本地记录的 ETag
            useSyncStore.getState().updateS3FileEtag(path, result.etag || '')
          }
          break
        }
        case 'webdav': {
          const webdavModule = await import('@/lib/sync/webdav') as any
          const webdavConfig = await getWebDAVConfig()
          if (webdavConfig) webdavConfig.url = mapping.remoteTarget || webdavConfig.url
          if (!webdavConfig) {
            console.warn('[SyncPushQueue] WebDAV 未配置')
            emitter.emit('sync-push-completed', { path, success: false })
            return { success: false }
          }

          // 获取代理配置
          const proxy = await getProxyConfig()

          const result = await webdavModule.webdavUpload(
            webdavConfig,
            remotePath,
            content,
            proxy,
            'text/markdown; charset=utf-8',
            {
              throwOnError: true,
              ifMatch: currentRemoteInfo.exists ? currentRemoteInfo.sha : undefined,
              ifNoneMatch: !currentRemoteInfo.exists,
            },
          )
          if (result) {
            success = true
            uploadedSha = result.etag || undefined
            // 更新本地记录的 ETag
            useSyncStore.getState().updateWebDAVFileEtag(path, result.etag || '')
          }
          break
        }
        case 'cloudFolder': {
          const config = await getCloudFolderWorkspaceConfig()
          if (config) config.path = mapping.remoteTarget || config.path
          if (!config) {
            emitter.emit('sync-push-completed', { path, success: false })
            return { success: false }
          }
          const { androidCloudFolderWorkspaceUpload } = await import('@/lib/sync/cloud-folder')
          const result = await androidCloudFolderWorkspaceUpload(config, remotePath, content)
          success = true
          uploadedSha = result.etag
          break
        }
      }

      if (success) {
        // 保存 scoped revision 和三方同步基线
        if (uploadedSha) {
          await setLocalRecordedSha(
            path,
            uploadedSha,
            await getSyncMetadataKey(path, mapping),
          )
        }
        await setSyncBaseline(path, mapping, {
          lastLocalContentSha: await calculateFileSha(content),
          lastRemoteRevision: uploadedSha,
          remoteExists: true,
        })
        emitter.emit('sync-push-completed', { path, success: true, sha: uploadedSha })
        return { success: true, sha: uploadedSha }
      } else {
        emitter.emit('sync-push-completed', { path, success: false })
        return { success: false }
      }
    } catch (error) {
      console.error('[SyncPushQueue] 强制推送失败:', error)
      emitter.emit('sync-push-completed', { path, success: false })
      return { success: false }
    }
  }

  /**
   * 清空队列
   */
  clear() {
    this.generation += 1
    this.queue = []
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  async prepareForWorkspaceSwitch() {
    this.workspaceSwitchPauseDepth += 1
    this.clear()
    const deadline = Date.now() + this.WORKSPACE_SWITCH_WAIT_TIMEOUT
    while (this.isProcessing) {
      if (Date.now() >= deadline) {
        console.warn('[SyncPushQueue] 工作区切换等待同步任务超时，旧任务将在后台安全结束')
        break
      }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }

  finishWorkspaceSwitch() {
    this.workspaceSwitchPauseDepth = Math.max(0, this.workspaceSwitchPauseDepth - 1)
    this.lastInputTime = Date.now()
  }
}

// 单例实例
let syncPushQueue: SyncPushQueue | null = null

export function getSyncPushQueue(): SyncPushQueue {
  if (!syncPushQueue) {
    syncPushQueue = new SyncPushQueue()
    syncPushQueue.init() // 确保只初始化一次事件监听器
  }
  return syncPushQueue
}

export default SyncPushQueue
