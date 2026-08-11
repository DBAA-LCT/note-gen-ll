import { invoke } from '@tauri-apps/api/core'
import { platform } from '@tauri-apps/plugin-os'
import { Buffer } from 'buffer'
import {
  isOneDriveConfig,
  oneDriveDelete,
  oneDriveDownloadBytes,
  oneDriveHeadObject,
  oneDriveListObjects,
  oneDriveUpload,
  testOneDriveConnection,
} from './onedrive'
import type { CloudFolderConfig } from '@/types/sync'

export interface CloudFolderObject {
  key: string
  size: number
  modifiedAt: number
  etag: string
}

interface CloudFolderContent {
  contentBase64: string
  size: number
  modifiedAt: number
  etag: string
}

export interface CloudFolderDownload {
  content: string
  etag: string
  size: number
  lastModified: string
}

export interface CloudFolderDownloadBytes {
  content: Uint8Array
  etag: string
  size: number
  lastModified: string
}

export interface WorkspaceMigrationResult {
  sourcePath: string
  targetPath: string
  copiedFiles: number
  skippedFiles: number
}

export interface AndroidFolderAccess {
  uri: string
  displayName: string
}

const SYNC_DIRECTORY = '.notegen/sync-v1'

function oneDriveSyncKey(key: string): string {
  return `${SYNC_DIRECTORY}/${key.replace(/^\/+/, '')}`
}

function fromOneDriveSyncObject(object: CloudFolderObject): CloudFolderObject {
  return {
    ...object,
    key: object.key.slice(SYNC_DIRECTORY.length).replace(/^\/+/, ''),
  }
}

export function supportsCloudFolderWorkspace(config: CloudFolderConfig): boolean {
  return isOneDriveConfig(config) || (platform() === 'android' && config.path.startsWith('content://'))
}

export async function pickAndroidSyncFolder(): Promise<AndroidFolderAccess | null> {
  return invoke<AndroidFolderAccess | null>('pick_android_sync_folder')
}

export async function releaseAndroidSyncFolder(rootUri: string): Promise<void> {
  await invoke('release_android_sync_folder', { rootUri })
}

function requirePath(config: CloudFolderConfig): string {
  const path = config.path.trim()
  if (!path) throw new Error('Cloud folder sync is not configured')
  return path
}

async function authorizedPath(config: CloudFolderConfig): Promise<string> {
  return requirePath(config)
}

function encodeContent(content: string | Uint8Array): string {
  return typeof content === 'string'
    ? Buffer.from(content, 'utf8').toString('base64')
    : Buffer.from(content).toString('base64')
}

function decodeBytes(content: string): Uint8Array {
  return new Uint8Array(Buffer.from(content, 'base64'))
}

export async function testCloudFolderConnection(config: CloudFolderConfig): Promise<boolean> {
  if (isOneDriveConfig(config)) return testOneDriveConnection(config)
  const root = await authorizedPath(config)
  if (platform() === 'android') {
    return invoke<boolean>('test_android_cloud_folder', { rootUri: root, scope: 'sync' })
  }
  return invoke<boolean>('test_cloud_folder_sync', { root })
}

export async function cloudFolderUpload(
  config: CloudFolderConfig,
  key: string,
  content: string | Uint8Array,
): Promise<CloudFolderObject> {
  if (isOneDriveConfig(config)) {
    const result = await oneDriveUpload(config, oneDriveSyncKey(key), content)
    return fromOneDriveSyncObject(result)
  }
  const root = await authorizedPath(config)
  if (platform() === 'android') {
    return invoke<CloudFolderObject>('write_android_cloud_folder_file', {
      rootUri: root,
      key,
      contentBase64: encodeContent(content),
      scope: 'sync',
    })
  }
  return invoke<CloudFolderObject>('write_cloud_folder_sync_file', {
    root,
    key,
    contentBase64: encodeContent(content),
  })
}

export async function cloudFolderDownloadBytes(
  config: CloudFolderConfig,
  key: string,
): Promise<CloudFolderDownloadBytes | null> {
  if (isOneDriveConfig(config)) {
    return oneDriveDownloadBytes(config, oneDriveSyncKey(key))
  }
  const root = await authorizedPath(config)
  const file = platform() === 'android'
    ? await invoke<CloudFolderContent | null>('read_android_cloud_folder_file', {
        rootUri: root,
        key,
        scope: 'sync',
      })
    : await invoke<CloudFolderContent | null>('read_cloud_folder_sync_file', { root, key })
  if (!file) return null
  return {
    content: decodeBytes(file.contentBase64),
    etag: file.etag,
    size: file.size,
    lastModified: new Date(file.modifiedAt).toISOString(),
  }
}

export async function cloudFolderDownload(
  config: CloudFolderConfig,
  key: string,
): Promise<CloudFolderDownload | null> {
  const file = await cloudFolderDownloadBytes(config, key)
  if (!file) return null
  return {
    ...file,
    content: new TextDecoder().decode(file.content),
  }
}

export async function cloudFolderHeadObject(
  config: CloudFolderConfig,
  key: string,
): Promise<CloudFolderObject | null> {
  if (isOneDriveConfig(config)) {
    const result = await oneDriveHeadObject(config, oneDriveSyncKey(key))
    return result ? fromOneDriveSyncObject(result) : null
  }
  const files = await cloudFolderListObjects(config, key)
  return files.find(file => file.key === key) ?? null
}

export async function cloudFolderDelete(config: CloudFolderConfig, key: string): Promise<boolean> {
  if (isOneDriveConfig(config)) return oneDriveDelete(config, oneDriveSyncKey(key))
  const root = await authorizedPath(config)
  if (platform() === 'android') {
    return invoke<boolean>('delete_android_cloud_folder_file', {
      rootUri: root,
      key,
      scope: 'sync',
    })
  }
  return invoke<boolean>('delete_cloud_folder_sync_file', {
    root,
    key,
  })
}

export async function cloudFolderListObjects(
  config: CloudFolderConfig,
  prefix = '',
): Promise<CloudFolderObject[]> {
  if (isOneDriveConfig(config)) {
    const remotePrefix = prefix ? oneDriveSyncKey(prefix) : SYNC_DIRECTORY
    return (await oneDriveListObjects(config, remotePrefix)).map(fromOneDriveSyncObject)
  }
  const root = await authorizedPath(config)
  if (platform() === 'android') {
    return invoke<CloudFolderObject[]>('list_android_cloud_folder_files', {
      rootUri: root,
      prefix: prefix || null,
      scope: 'sync',
    })
  }
  return invoke<CloudFolderObject[]>('list_cloud_folder_sync_files', {
    root,
    prefix,
  })
}

export async function androidCloudFolderWorkspaceUpload(
  config: CloudFolderConfig,
  key: string,
  content: string | Uint8Array,
): Promise<CloudFolderObject> {
  if (isOneDriveConfig(config)) return oneDriveUpload(config, key, content)
  return invoke<CloudFolderObject>('write_android_cloud_folder_file', {
    rootUri: requirePath(config),
    key,
    contentBase64: encodeContent(content),
    scope: 'workspace',
  })
}

export async function androidCloudFolderWorkspaceDownloadBytes(
  config: CloudFolderConfig,
  key: string,
): Promise<CloudFolderDownloadBytes | null> {
  if (isOneDriveConfig(config)) return oneDriveDownloadBytes(config, key)
  const file = await invoke<CloudFolderContent | null>('read_android_cloud_folder_file', {
    rootUri: requirePath(config),
    key,
    scope: 'workspace',
  })
  if (!file) return null
  return {
    content: decodeBytes(file.contentBase64),
    etag: file.etag,
    size: file.size,
    lastModified: new Date(file.modifiedAt).toISOString(),
  }
}

export async function androidCloudFolderWorkspaceList(
  config: CloudFolderConfig,
  prefix = '',
): Promise<CloudFolderObject[]> {
  if (isOneDriveConfig(config)) {
    return (await oneDriveListObjects(config, prefix)).filter(object => (
      !object.key.split('/').some(segment => segment.startsWith('.'))
    ))
  }
  return invoke<CloudFolderObject[]>('list_android_cloud_folder_files', {
    rootUri: requirePath(config),
    prefix: prefix || null,
    scope: 'workspace',
  })
}

export async function androidCloudFolderWorkspaceHead(
  config: CloudFolderConfig,
  key: string,
): Promise<CloudFolderObject | null> {
  if (isOneDriveConfig(config)) return oneDriveHeadObject(config, key)
  const files = await androidCloudFolderWorkspaceList(config, key)
  return files.find(file => file.key === key) ?? null
}

export async function androidCloudFolderWorkspaceDelete(
  config: CloudFolderConfig,
  key: string,
): Promise<boolean> {
  if (isOneDriveConfig(config)) return oneDriveDelete(config, key)
  return invoke<boolean>('delete_android_cloud_folder_file', {
    rootUri: requirePath(config),
    key,
    scope: 'workspace',
  })
}

export async function migrateWorkspaceToCloudFolder(
  config: CloudFolderConfig,
  sourcePath?: string,
): Promise<WorkspaceMigrationResult> {
  return invoke<WorkspaceMigrationResult>('migrate_workspace_to_cloud_folder', {
    root: await authorizedPath(config),
    sourcePath: sourcePath?.trim() || null,
  })
}
