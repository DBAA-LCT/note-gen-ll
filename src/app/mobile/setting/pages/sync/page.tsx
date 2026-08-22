'use client'

import { FileDown, Loader2, RefreshCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import { Store } from '@tauri-apps/plugin-store'
import { GithubSync } from '@/app/core/setting/sync/github-sync'
import { GiteeSync } from '@/app/core/setting/sync/gitee-sync'
import { GitlabSync } from '@/app/core/setting/sync/gitlab-sync'
import { GiteaSync } from '@/app/core/setting/sync/gitea-sync'
import { S3Sync } from '@/app/core/setting/sync/s3-sync'
import { WebDAVSync } from '@/app/core/setting/sync/webdav-sync'
import { ConnectorMappingTree } from '@/app/core/setting/sync/components/connector-mapping-tree'
import { DataSyncOverview } from '@/app/core/setting/sync/components/data-sync-overview'
import { MobileSelectDrawer } from '@/app/mobile/components/mobile-select-drawer'
import { OneDriveCloudFolderSync } from '@/app/mobile/setting/pages/sync/android-cloud-folder-sync'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { isTauriRuntime } from '@/lib/check'
import { SyncStateEnum } from '@/lib/sync/github.types'
import useSettingStore from '@/stores/setting'
import useSyncStore from '@/stores/sync'
import { SYNC_PLATFORMS, SYNC_PLATFORM_INFO, SyncPlatform, type CloudFolderConfig } from '@/types/sync'

type MobileSyncPlatform = SyncPlatform | 'oneDrive'

function toSyncPlatform(platformName: MobileSyncPlatform): SyncPlatform {
  return platformName === 'oneDrive' ? 'cloudFolder' : platformName
}

export default function SyncPage() {
  const t = useTranslations()
  const isAndroid = isTauriRuntime() && platform() === 'android'
  const standardPlatforms = SYNC_PLATFORMS.filter(platformName => platformName !== 'cloudFolder')
  const availablePlatforms: MobileSyncPlatform[] = isAndroid
    ? [...standardPlatforms, 'oneDrive']
    : standardPlatforms
  const {
    primaryBackupMethod,
    setPrimaryBackupMethod,
    autoSync,
    setAutoSync,
    autoRecordSyncEnabled,
    setAutoRecordSyncEnabled,
    autoSettingsSyncEnabled,
    setAutoSettingsSyncEnabled,
    autoConversationSyncEnabled,
    setAutoConversationSyncEnabled,
    excludeSensitiveConfig,
    setExcludeSensitiveConfig,
    autoPullOnOpen,
    setAutoPullOnOpen,
    syncAccessMode,
    workspacePath,
    workspaceHistory,
  } = useSettingStore()
  const {
    syncRepoState,
    giteeSyncRepoState,
    gitlabSyncProjectState,
    giteaSyncRepoState,
    s3Connected,
    webdavConnected,
    cloudFolderConnected,
  } = useSyncStore()
  const effectivePrimaryBackupMethod: SyncPlatform = SYNC_PLATFORMS.includes(primaryBackupMethod)
    ? primaryBackupMethod
    : 'github'

  const [tab, setTab] = useState<MobileSyncPlatform>(effectivePrimaryBackupMethod)
  const [isLoading, setIsLoading] = useState(true)
  const [activeCloudFolderProvider, setActiveCloudFolderProvider] = useState<'folder' | 'oneDrive' | null>(null)
  const [switchingPrimary, setSwitchingPrimary] = useState(false)

  const workspaceOptions = useMemo(
    () => Array.from(new Set([workspacePath, '', ...workspaceHistory])),
    [workspaceHistory, workspacePath],
  )

  useEffect(() => {
    async function loadPrimaryBackupMethod() {
      try {
        const store = await Store.load('store.json')
        const savedMethod = await store.get<SyncPlatform>('primaryBackupMethod')
        const cloudFolderConfig = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
        setActiveCloudFolderProvider(
          cloudFolderConfig?.path
            ? cloudFolderConfig.provider === 'oneDrive' ? 'oneDrive' : 'folder'
            : null,
        )
        if (savedMethod) {
          const nextTab: MobileSyncPlatform = savedMethod !== 'cloudFolder'
            ? savedMethod
            : isAndroid
              ? 'oneDrive'
              : 'github'
          setTab(nextTab)
        }
      } catch (error) {
        console.error('Failed to load primary backup method:', error)
      } finally {
        setIsLoading(false)
      }
    }

    void loadPrimaryBackupMethod()
  }, [isAndroid])

  const selectedSyncPlatform = toSyncPlatform(tab)
  const selectedSyncState = getCurrentSyncState(selectedSyncPlatform)
  const activeWorkspaceSyncState = getCurrentSyncState(effectivePrimaryBackupMethod)
  const isProviderUnavailable = activeWorkspaceSyncState !== SyncStateEnum.success
  const isFileAutoSyncDisabled = isProviderUnavailable || syncAccessMode === 'read-only'
  const isCloudFolderTab = selectedSyncPlatform === 'cloudFolder'
  const supportsCloudFolderFileSync = tab === 'oneDrive'

  function getCurrentSyncState(platform: SyncPlatform) {
    switch (platform) {
      case 'github':
        return syncRepoState
      case 'gitee':
        return giteeSyncRepoState
      case 'gitlab':
        return gitlabSyncProjectState
      case 'gitea':
        return giteaSyncRepoState
      case 's3':
        return s3Connected ? SyncStateEnum.success : SyncStateEnum.fail
      case 'webdav':
        return webdavConnected ? SyncStateEnum.success : SyncStateEnum.fail
      case 'cloudFolder':
        return cloudFolderConnected
          && activeCloudFolderProvider === 'oneDrive'
          ? SyncStateEnum.success
          : SyncStateEnum.fail
      default:
        return syncRepoState
    }
  }

  function getProviderLabel(platform: MobileSyncPlatform) {
    if (platform === 'oneDrive' || platform === 'cloudFolder') return t('settings.sync.cloudFolder.title')
    return SYNC_PLATFORM_INFO[platform].name
  }

  function handleTabChange(value: string) {
    const nextTab = value as MobileSyncPlatform
    setTab(nextTab)
  }

  async function handleSetPrimaryPlatform() {
    if (selectedSyncPlatform === effectivePrimaryBackupMethod || switchingPrimary) return
    setSwitchingPrimary(true)
    try {
      await setPrimaryBackupMethod(selectedSyncPlatform)
      toast({ title: t('settings.sync.currentPlatform'), description: getProviderLabel(tab) })
    } catch (error) {
      toast({
        title: t('settings.sync.settings'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setSwitchingPrimary(false)
    }
  }

  async function handleExcludeSensitiveConfigChange(checked: boolean) {
    if (!checked) {
      const accepted = await confirm(t('settings.sync.autoDataSyncPrivacyDisableConfirm'), {
        title: t('settings.sync.autoDataSyncPrivacyTitle'),
        kind: 'warning',
      })
      if (!accepted) return
    }

    await setExcludeSensitiveConfig(checked)
  }

  function renderSyncContent() {
    switch (tab) {
      case 'github':
        return <GithubSync />
      case 'gitee':
        return <GiteeSync />
      case 'gitlab':
        return <GitlabSync />
      case 'gitea':
        return <GiteaSync />
      case 's3':
        return <S3Sync />
      case 'webdav':
        return <WebDAVSync />
      case 'oneDrive':
      case 'cloudFolder':
        return isAndroid
          ? <OneDriveCloudFolderSync onActiveProviderChange={setActiveCloudFolderProvider} />
          : <GithubSync />
      default:
        return <GithubSync />
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t('settings.sync.desc')}
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t('settings.sync.currentPlatform')}</h2>
        <div className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-3">
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{t('settings.sync.currentPlatform')}</p>
              <p className="truncate text-sm font-medium">{getProviderLabel(effectivePrimaryBackupMethod)}</p>
            </div>
            <div className="flex items-center gap-2">
              {activeWorkspaceSyncState === SyncStateEnum.success ? (
                <Badge className="bg-green-600 text-white">{t('settings.sync.status.connected')}</Badge>
              ) : (
                <Badge variant="destructive">{t('settings.sync.status.disconnected')}</Badge>
              )}
              {syncAccessMode === 'read-only' ? (
                <Badge variant="secondary">{t('settings.sync.readOnly')}</Badge>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.sync.primaryPlatformDesc')}</p>
        </div>

        <Item variant="outline">
          <ItemMedia variant="icon"><RefreshCcw className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('settings.sync.autoSync')}</ItemTitle>
            <ItemDescription>{t('settings.sync.autoSyncDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <MobileSelectDrawer
              title={t('settings.sync.autoSync')}
              value={autoSync}
              onValueChange={(value) => setAutoSync(value)}
              disabled={isFileAutoSyncDisabled || (isCloudFolderTab && !supportsCloudFolderFileSync)}
              className="min-w-32"
              placeholder={t('settings.sync.autoSyncOptions.placeholder')}
              options={[
                { value: 'disabled', label: t('settings.sync.autoSyncOptions.disabled') },
                { value: '2', label: t('settings.sync.autoSyncOptions.2s') },
                { value: '3', label: t('settings.sync.autoSyncOptions.3s') },
                { value: '5', label: t('settings.sync.autoSyncOptions.5s') },
                { value: '10', label: t('settings.sync.autoSyncOptions.10s') },
                { value: '20', label: t('settings.sync.autoSyncOptions.20s') },
                { value: '30', label: t('settings.sync.autoSyncOptions.30s') },
                { value: '60', label: t('settings.sync.autoSyncOptions.1m') },
                { value: '120', label: t('settings.sync.autoSyncOptions.2m') },
              ]}
            />
          </ItemActions>
        </Item>

        <Item variant="outline">
          <ItemMedia variant="icon"><FileDown className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('settings.sync.autoPullOnOpen')}</ItemTitle>
            <ItemDescription>{t('settings.sync.autoPullOnOpenDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions className="mobile-setting-inline-action">
            <Switch
              checked={autoPullOnOpen}
              onCheckedChange={setAutoPullOnOpen}
              disabled={isProviderUnavailable || (isCloudFolderTab && !supportsCloudFolderFileSync)}
            />
          </ItemActions>
        </Item>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t('settings.sync.connectionManagement')}</h2>
        <p className="text-sm text-muted-foreground">{t('settings.sync.connectionManagementDesc')}</p>
        <MobileSelectDrawer
          title={t('settings.sync.selectPlatform')}
          value={tab}
          onValueChange={handleTabChange}
          placeholder={t('settings.sync.selectPlatform')}
          className="h-11"
          options={availablePlatforms.map(platformName => ({
            value: platformName,
            label: getProviderLabel(platformName),
          }))}
        />
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/20 px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{t('settings.sync.selectedPlatform')}</p>
            <p className="truncate text-sm font-medium">{getProviderLabel(tab)}</p>
          </div>
          {selectedSyncState === SyncStateEnum.success ? (
            <Badge className="bg-green-600 text-white">{t('settings.sync.status.connected')}</Badge>
          ) : (
            <Badge variant="destructive">{t('settings.sync.status.disconnected')}</Badge>
          )}
          {selectedSyncPlatform !== effectivePrimaryBackupMethod ? (
            <Button
              size="sm"
              variant="outline"
              disabled={switchingPrimary || selectedSyncState !== SyncStateEnum.success}
              onClick={() => void handleSetPrimaryPlatform()}
            >
              {switchingPrimary ? <Loader2 className="animate-spin" /> : null}
              {t('settings.sync.setCurrentPlatform')}
            </Button>
          ) : null}
        </div>
        {renderSyncContent()}
        <ConnectorMappingTree
          platform={selectedSyncPlatform}
          workspaceOptions={workspaceOptions}
          currentWorkspacePath={workspacePath}
        />
      </section>

      <DataSyncOverview
        mobile
        autoRecordSyncEnabled={autoRecordSyncEnabled}
        autoSettingsSyncEnabled={autoSettingsSyncEnabled}
        autoConversationSyncEnabled={autoConversationSyncEnabled}
        excludeSensitiveConfig={excludeSensitiveConfig}
        onRecordSyncChange={setAutoRecordSyncEnabled}
        onSettingsSyncChange={setAutoSettingsSyncEnabled}
        onConversationSyncChange={setAutoConversationSyncEnabled}
        onSensitiveConfigChange={handleExcludeSensitiveConfigChange}
      />
    </div>
  )
}
