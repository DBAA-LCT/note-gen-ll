'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import {
  Cloud,
  Database,
  FileDown,
  FileUp,
  FolderSync,
  GitBranch,
  GitFork,
  Loader2,
  Network,
  RefreshCcw,
  Server,
  type LucideIcon,
} from 'lucide-react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'

import { GiteeSync } from './gitee-sync'
import { GiteaSync } from './gitea-sync'
import { GithubSync } from './github-sync'
import { GitlabSync } from './gitlab-sync'
import { S3Sync } from './s3-sync'
import { WebDAVSync } from './webdav-sync'
import { CloudFolderSync } from './cloud-folder-sync'
import { DataSyncOverview } from './components/data-sync-overview'
import { ConnectorMappingTree } from './components/connector-mapping-tree'
import { SettingType } from '../components/setting-base'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { SyncStateEnum } from '@/lib/sync/github.types'
import { checkSyncProviderStatus } from '@/lib/sync/provider-status'
import useSettingStore from '@/stores/setting'
import useSyncStore from '@/stores/sync'
import { SYNC_PLATFORMS, SYNC_PLATFORM_INFO, type SyncPlatform } from '@/types/sync'

const PLATFORM_ICONS: Record<SyncPlatform, LucideIcon> = {
  github: GitBranch,
  gitee: GitFork,
  gitlab: Network,
  gitea: Server,
  s3: Database,
  webdav: Cloud,
  cloudFolder: FolderSync,
}

const PLATFORM_LOGOS: Partial<Record<SyncPlatform, string>> = {
  github: '/sync-platforms/github.svg',
  gitee: '/sync-platforms/gitee.svg',
  gitlab: '/sync-platforms/gitlab.svg',
  gitea: '/sync-platforms/gitea.svg',
}

export default function SyncPage() {
  const t = useTranslations()
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

  const [platform, setPlatform] = useState<SyncPlatform>(effectivePrimaryBackupMethod)
  const [isLoading, setIsLoading] = useState(true)
  const [checkingPlatforms, setCheckingPlatforms] = useState<Set<SyncPlatform>>(new Set())
  const [switchingPrimary, setSwitchingPrimary] = useState(false)
  const checkingPlatformsRef = useRef<Set<SyncPlatform>>(new Set())

  const workspaceOptions = useMemo(
    () => Array.from(new Set([workspacePath, '', ...workspaceHistory])),
    [workspaceHistory, workspacePath],
  )

  const checkPlatformStatus = useCallback(async (targetPlatform: SyncPlatform) => {
    if (checkingPlatformsRef.current.has(targetPlatform)) return

    checkingPlatformsRef.current.add(targetPlatform)
    setCheckingPlatforms(new Set(checkingPlatformsRef.current))
    try {
      await checkSyncProviderStatus(targetPlatform)
    } finally {
      checkingPlatformsRef.current.delete(targetPlatform)
      setCheckingPlatforms(new Set(checkingPlatformsRef.current))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadConnectorStatuses() {
      await checkPlatformStatus(effectivePrimaryBackupMethod)
      if (!cancelled) setIsLoading(false)
    }
    void loadConnectorStatuses()
    return () => { cancelled = true }
  }, [checkPlatformStatus, effectivePrimaryBackupMethod])

  useEffect(() => {
    if (!isLoading) void checkPlatformStatus(platform)
  }, [checkPlatformStatus, isLoading, platform])

  function getSyncState(targetPlatform: SyncPlatform) {
    if (checkingPlatforms.has(targetPlatform)) return SyncStateEnum.checking

    switch (targetPlatform) {
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
        return cloudFolderConnected ? SyncStateEnum.success : SyncStateEnum.fail
    }
  }

  const currentSyncState = getSyncState(platform)
  const primarySyncState = getSyncState(effectivePrimaryBackupMethod)
  const isProviderUnavailable = primarySyncState !== SyncStateEnum.success
  const isAutoSyncDisabled = isProviderUnavailable
  const getPlatformName = useCallback((target: SyncPlatform) => {
    return target === 'cloudFolder'
      ? t('settings.sync.cloudFolder.title')
      : SYNC_PLATFORM_INFO[target].name
  }, [t])

  function handlePlatformChange(nextPlatform: SyncPlatform) {
    setPlatform(nextPlatform)
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
    switch (platform) {
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
      case 'cloudFolder':
        return <CloudFolderSync />
    }
  }

  function renderStatusBadge(state: SyncStateEnum) {
    const isChecking = state === SyncStateEnum.checking || state === SyncStateEnum.creating

    if (state === SyncStateEnum.success) {
      return (
        <Badge className="bg-green-600 text-white">
          {t('settings.sync.status.connected')}
        </Badge>
      )
    }

    if (isChecking) {
      return (
        <Badge variant="secondary">
          <Loader2 data-icon="inline-start" className="animate-spin" />
          {state === SyncStateEnum.checking
            ? t('settings.sync.checking')
            : t('settings.sync.creating')}
        </Badge>
      )
    }

    return <Badge variant="destructive">{t('settings.sync.status.disconnected')}</Badge>
  }

  async function handleSetPrimaryPlatform() {
    if (platform === effectivePrimaryBackupMethod || switchingPrimary) return
    setSwitchingPrimary(true)
    try {
      await setPrimaryBackupMethod(platform)
      toast({ title: t('settings.sync.currentPlatform'), description: currentPlatformName })
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

  function renderCompactStatus(state: SyncStateEnum) {
    const checking = state === SyncStateEnum.checking || state === SyncStateEnum.creating
    const connected = state === SyncStateEnum.success
    const label = checking
      ? t('settings.sync.checking')
      : connected
        ? t('settings.sync.status.connected')
        : t('settings.sync.status.disconnected')
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={label}>
        <span className={cn(
          'size-2 rounded-full',
          checking && 'animate-pulse bg-amber-500',
          connected && 'bg-emerald-500',
          !checking && !connected && 'bg-muted-foreground/35',
        )} />
        <span className="sr-only">{label}</span>
      </span>
    )
  }

  if (isLoading) {
    return (
      <SettingType id="sync" icon={<FileUp />} title={t('settings.sync.title')} desc={t('settings.sync.desc')}>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-muted-foreground" />
        </div>
      </SettingType>
    )
  }

  return (
    <SettingType id="sync" icon={<FileUp />} title={t('settings.sync.title')} desc={t('settings.sync.desc')}>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SyncPlatformIcon platform={effectivePrimaryBackupMethod} />
              <span>{t('settings.sync.currentPlatform')}</span>
            </CardTitle>
            <CardDescription>{t('settings.sync.primaryPlatformDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold">{getPlatformName(effectivePrimaryBackupMethod)}</span>
              {renderStatusBadge(primarySyncState)}
              {syncAccessMode === 'read-only' ? (
                <Badge variant="secondary">{t('settings.sync.readOnly')}</Badge>
              ) : null}
            </div>

            <ItemGroup>
              <Item variant="outline">
                <ItemMedia variant="icon"><RefreshCcw /></ItemMedia>
                <ItemContent>
                  <ItemTitle>{t('settings.sync.autoSync')}</ItemTitle>
                  <ItemDescription>{t('settings.sync.autoSyncDesc')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Select
                    value={autoSync}
                    onValueChange={setAutoSync}
                    disabled={isAutoSyncDisabled || effectivePrimaryBackupMethod === 'cloudFolder'}
                  >
                    <SelectTrigger className="w-45">
                      <SelectValue placeholder={t('settings.sync.autoSyncOptions.placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="disabled">{t('settings.sync.autoSyncOptions.disabled')}</SelectItem>
                        <SelectItem value="2">{t('settings.sync.autoSyncOptions.2s')}</SelectItem>
                        <SelectItem value="3">{t('settings.sync.autoSyncOptions.3s')}</SelectItem>
                        <SelectItem value="5">{t('settings.sync.autoSyncOptions.5s')}</SelectItem>
                        <SelectItem value="10">{t('settings.sync.autoSyncOptions.10s')}</SelectItem>
                        <SelectItem value="20">{t('settings.sync.autoSyncOptions.20s')}</SelectItem>
                        <SelectItem value="30">{t('settings.sync.autoSyncOptions.30s')}</SelectItem>
                        <SelectItem value="60">{t('settings.sync.autoSyncOptions.1m')}</SelectItem>
                        <SelectItem value="120">{t('settings.sync.autoSyncOptions.2m')}</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </ItemActions>
              </Item>

              <Item variant="outline">
                <ItemMedia variant="icon"><FileDown /></ItemMedia>
                <ItemContent>
                  <ItemTitle>{t('settings.sync.autoPullOnOpen')}</ItemTitle>
                  <ItemDescription>{t('settings.sync.autoPullOnOpenDesc')}</ItemDescription>
                </ItemContent>
                <ItemActions className="mobile-setting-inline-action">
                  <Switch
                    checked={autoPullOnOpen}
                    onCheckedChange={setAutoPullOnOpen}
                    disabled={isProviderUnavailable || effectivePrimaryBackupMethod === 'cloudFolder'}
                  />
                </ItemActions>
              </Item>
            </ItemGroup>
          </CardContent>
        </Card>

        <div className="grid items-start gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
          <Card size="sm" className="lg:sticky lg:top-2">
            <CardHeader>
              <CardTitle>{t('settings.sync.connectionManagement')}</CardTitle>
              <CardDescription>{t('settings.sync.connectionManagementDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <ItemGroup className="gap-1">
                {SYNC_PLATFORMS.map((itemPlatform) => {
                  const isSelectedPlatform = platform === itemPlatform
                  return (
                    <Item
                      key={itemPlatform}
                      asChild
                      size="sm"
                      variant={isSelectedPlatform ? 'outline' : 'default'}
                      className="data-[state=on]:border-primary data-[state=on]:bg-primary/5"
                    >
                      <button
                        type="button"
                        data-state={isSelectedPlatform ? 'on' : 'off'}
                        aria-pressed={isSelectedPlatform}
                        onClick={() => void handlePlatformChange(itemPlatform)}
                      >
                        <ItemMedia>
                          <SyncPlatformIcon platform={itemPlatform} small />
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>{getPlatformName(itemPlatform)}</ItemTitle>
                        </ItemContent>
                        <ItemActions>
                          {renderCompactStatus(getSyncState(itemPlatform))}
                        </ItemActions>
                      </button>
                    </Item>
                  )
                })}
              </ItemGroup>
            </CardContent>
          </Card>

          <div className="flex min-w-0 flex-col gap-4">
            <Card>
              <CardHeader>
                <div className="flex min-w-0 items-center gap-3">
                  <SyncPlatformIcon platform={platform} />
                  <div className="min-w-0 flex-1">
                    <CardTitle>{getPlatformName(platform)}</CardTitle>
                    <CardDescription>{t('settings.sync.platformDesc')}</CardDescription>
                  </div>
                </div>
                <CardAction className="flex flex-wrap items-center justify-end gap-2">
                  {platform === effectivePrimaryBackupMethod ? (
                    <Badge>{t('settings.sync.currentPlatform')}</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={switchingPrimary || currentSyncState !== SyncStateEnum.success}
                      onClick={() => void handleSetPrimaryPlatform()}
                    >
                      {switchingPrimary ? <Loader2 className="animate-spin" /> : null}
                      {t('settings.sync.setCurrentPlatform')}
                    </Button>
                  )}
                  {renderStatusBadge(currentSyncState)}
                </CardAction>
              </CardHeader>
            </Card>
            {renderSyncContent()}
            <ConnectorMappingTree
              platform={platform}
              workspaceOptions={workspaceOptions}
              currentWorkspacePath={workspacePath}
            />
          </div>
        </div>

        <DataSyncOverview
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
    </SettingType>
  )
}

function SyncPlatformIcon({
  platform,
  small = false,
}: {
  platform: SyncPlatform
  small?: boolean
}) {
  const platformInfo = SYNC_PLATFORM_INFO[platform]
  const PlatformIcon = PLATFORM_ICONS[platform]
  const logo = PLATFORM_LOGOS[platform]

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center',
        small ? 'size-6' : 'size-8',
      )}
    >
      {logo ? (
        <Image
          className="size-full object-contain"
          src={logo}
          alt={`${platformInfo.name} logo`}
          width={small ? 24 : 32}
          height={small ? 24 : 32}
        />
      ) : (
        <PlatformIcon className="size-full" />
      )}
    </span>
  )
}
