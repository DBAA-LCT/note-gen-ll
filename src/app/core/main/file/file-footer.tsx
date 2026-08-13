'use client'

import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  ChevronsUpDown,
  Cloud,
  FolderCheck,
  FolderOpen,
  FolderPlus,
  Network,
  Trash2,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { getDefaultArticleAbsolutePath } from '@/lib/workspace'
import { getWorkspaceDisplayName } from '@/lib/workspace-name'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import { useSkillsStore } from '@/stores/skills'

import { useSyncAvailability } from './use-sync-availability'
import {
  getConnectorMappings,
  type ConnectorSyncMapping,
} from '@/lib/sync/connector-mappings'
import { getWorkspaceSyncKey } from '@/lib/sync/workspace-sync-config'
import emitter from '@/lib/emitter'
import { SYNC_PLATFORM_INFO } from '@/types/sync'

export function FileFooter() {
  const {
    workspacePath,
    workspaceHistory,
    setWorkspacePath,
    removeWorkspaceHistory,
  } = useSettingStore()
  const { refreshSkills } = useSkillsStore()
  const {
    loadWorkspaceCollapsibleList,
    loadFileTree,
    setActiveFilePath,
    setCurrentArticle,
  } = useArticleStore()
  const tFile = useTranslations('settings.file')
  const tContext = useTranslations('article.file.context')
  const tSync = useTranslations('settings.sync')
  const sync = useSyncAvailability()
  const [open, setOpen] = useState(false)
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false)
  const [defaultWorkspacePath, setDefaultWorkspacePath] = useState('')
  const [workspaceMappings, setWorkspaceMappings] = useState<ConnectorSyncMapping[]>([])

  const defaultWorkspaceName = tFile('workspace.defaultPath')
  const currentWorkspaceName = useMemo(
    () => getWorkspaceDisplayName(workspacePath, defaultWorkspaceName),
    [defaultWorkspaceName, workspacePath]
  )
  const currentWorkspacePath = workspacePath
    || defaultWorkspacePath
    || defaultWorkspaceName
  const syncStatusText = sync.status === 'available'
    ? tContext('syncAvailable', { platform: sync.platform })
    : sync.status === 'checking'
      ? tContext('syncChecking', { platform: sync.platform })
      : sync.status === 'unavailable'
        ? tContext('syncUnavailable', { platform: sync.platform })
        : tContext('syncNotConfigured')
  const remoteSummary = useMemo(() => {
    if (!workspaceMappings.length) return tSync('mapping.noRemote')
    const uniqueRemotes = Array.from(new Map(workspaceMappings.map(mapping => [
      `${mapping.platform}\0${mapping.remoteTarget}`,
      mapping,
    ])).values())
    const first = uniqueRemotes[0]
    const platformName = first.platform === 'cloudFolder'
      ? tSync('cloudFolder.title')
      : SYNC_PLATFORM_INFO[first.platform].name
    const target = first.remoteTarget
    if (uniqueRemotes.length === 1) return `${platformName} · ${target}`
    return tSync('mapping.remoteSummary', {
      remote: `${platformName} · ${target}`,
      count: uniqueRemotes.length - 1,
    })
  }, [tSync, workspaceMappings])

  useEffect(() => {
    let cancelled = false
    const loadMappings = () => {
      void getConnectorMappings().then((mappings) => {
        if (cancelled) return
        const workspaceKey = getWorkspaceSyncKey(workspacePath)
        setWorkspaceMappings(mappings
          .filter(mapping => (
            mapping.enabled
            && getWorkspaceSyncKey(mapping.localWorkspacePath) === workspaceKey
          ))
          .sort((a, b) => a.localPath.length - b.localPath.length))
      })
    }
    loadMappings()
    emitter.on('sync-mappings-changed', loadMappings)
    return () => {
      cancelled = true
      emitter.off('sync-mappings-changed', loadMappings)
    }
  }, [workspacePath])

  useEffect(() => {
    void getDefaultArticleAbsolutePath('')
      .then(setDefaultWorkspacePath)
      .catch((error) => console.error('获取默认工作区路径失败:', error))
  }, [])

  async function restoreWorkspaceContent() {
    setActiveFilePath('')
    setCurrentArticle('')
    const lastActivePath = await loadWorkspaceCollapsibleList()
    await loadFileTree()
    if (lastActivePath) await setActiveFilePath(lastActivePath)
  }

  async function switchWorkspace(path: string) {
    if (switchingWorkspace) return
    if (path === workspacePath) {
      setOpen(false)
      return
    }

    const previousWorkspacePath = workspacePath
    setSwitchingWorkspace(true)

    try {
      await setWorkspacePath(path)
      await restoreWorkspaceContent()
      await refreshSkills()
      setOpen(false)
    } catch (error) {
      console.error('切换工作区失败:', error)

      try {
        await setWorkspacePath(previousWorkspacePath)
        await restoreWorkspaceContent()
        await refreshSkills()
      } catch (rollbackError) {
        console.error('恢复原工作区失败:', rollbackError)
      }

      toast({
        title: tFile('workspace.switchFailed'),
        variant: 'destructive',
      })
    } finally {
      setSwitchingWorkspace(false)
    }
  }

  async function handleSelectWorkspace() {
    setOpen(false)

    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: tFile('workspace.select'),
      })

      if (selected) await switchWorkspace(selected as string)
    } catch (error) {
      console.error('选择工作区失败:', error)
    }
  }

  function handleRemoveWorkspace(
    event: MouseEvent<HTMLButtonElement>,
    path: string
  ) {
    event.preventDefault()
    event.stopPropagation()
    void removeWorkspaceHistory(path)
  }

  return (
    <div className="relative flex h-6 min-h-6 max-h-6 shrink-0 items-center overflow-hidden border-t border-border bg-background text-xs text-muted-foreground">
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                disabled={switchingWorkspace}
                className="w-full min-w-0 flex-1 justify-start border-0 bg-transparent px-1.5 text-xs font-normal text-muted-foreground focus-visible:border-transparent focus-visible:ring-1 focus-visible:ring-ring/30"
                aria-label={`${currentWorkspaceName}, ${remoteSummary}, ${syncStatusText}`}
              >
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    sync.status === 'available' && 'bg-emerald-500',
                    sync.status === 'checking' && 'bg-amber-500 animate-pulse',
                    sync.status === 'unavailable' && 'bg-destructive',
                    sync.status === 'not-configured' && 'bg-muted-foreground/40'
                  )}
                  aria-hidden="true"
                />
                {switchingWorkspace ? (
                  <Spinner data-icon="inline-start" className="size-3" />
                ) : (
                  <FolderOpen data-icon="inline-start" />
                )}
                <span className="min-w-0 flex-1 truncate text-left">
                  {currentWorkspaceName}
                </span>
                <span className="flex max-w-[55%] shrink min-w-0 items-center gap-1 truncate rounded bg-muted/70 px-1 py-0.5 text-[10px] text-muted-foreground">
                  <Cloud className="size-2.5 shrink-0" />
                  <span className="truncate">{remoteSummary}</span>
                </span>
                <ChevronsUpDown data-icon="inline-end" className="opacity-50" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4} className="max-w-sm">
            <span className="block break-all">{currentWorkspacePath}</span>
            <span className="block break-all text-xs">{remoteSummary}</span>
            <span className="block text-xs opacity-70">{syncStatusText}</span>
          </TooltipContent>
        </Tooltip>

        <PopoverContent
          side="top"
          align="start"
          sideOffset={6}
          className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1rem)] p-0"
        >
          <Command>
            <CommandInput placeholder={tFile('workspace.searchPlaceholder')} />
            <CommandList className="[scrollbar-gutter:auto]">
              <CommandEmpty>{tFile('workspace.noResults')}</CommandEmpty>
              <CommandGroup heading={tSync('mapping.currentWorkspaceRemotes')}>
                {workspaceMappings.length ? workspaceMappings.map((mapping) => {
                  const platformName = mapping.platform === 'cloudFolder'
                    ? tSync('cloudFolder.title')
                    : SYNC_PLATFORM_INFO[mapping.platform].name
                  const remotePath = [mapping.remoteTarget, mapping.remotePath].filter(Boolean).join('/')
                  return (
                    <CommandItem
                      key={mapping.id}
                      value={`${platformName} ${remotePath} ${mapping.localPath}`}
                      disabled
                      className="items-start opacity-100 aria-disabled:opacity-100"
                    >
                      <Network className="mt-0.5 text-emerald-600" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 font-medium text-foreground">
                          <span>{platformName}</span>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {remotePath}
                        </span>
                        <span className="block truncate text-[10px] text-muted-foreground/70">
                          {mapping.localPath || tSync('mapping.workspaceRoot')}
                          {' → '}
                          {mapping.remotePath || tSync('mapping.remoteRoot')}
                        </span>
                      </span>
                    </CommandItem>
                  )
                }) : (
                  <div className="px-2 py-2 text-xs text-muted-foreground">
                    {tSync('mapping.noRemote')}
                  </div>
                )}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading={tFile('workspace.actions')}>
                <CommandItem
                  value={tFile('workspace.select')}
                  disabled={switchingWorkspace}
                  onSelect={() => void handleSelectWorkspace()}
                >
                  <FolderPlus />
                  <span>{tFile('workspace.select')}</span>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading={tFile('workspace.list')}>
                <CommandItem
                  value={`${defaultWorkspaceName} ${defaultWorkspacePath}`}
                  data-checked={!workspacePath}
                  aria-current={!workspacePath ? 'true' : undefined}
                  disabled={switchingWorkspace}
                  onSelect={() => void switchWorkspace('')}
                  className={cn(
                    'items-start [&>svg:last-child]:hidden',
                    workspacePath
                      ? 'text-muted-foreground/70 [&>svg:first-child]:opacity-60'
                      : 'text-foreground [&>svg:first-child]:text-primary'
                  )}
                >
                  {workspacePath ? (
                    <FolderOpen className="mt-0.5" />
                  ) : (
                    <FolderCheck className="mt-0.5" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {defaultWorkspaceName}
                    </span>
                    {defaultWorkspacePath && (
                      <span className="block truncate text-xs text-muted-foreground/70">
                        {defaultWorkspacePath}
                      </span>
                    )}
                  </span>
                </CommandItem>

                {workspaceHistory.map((path) => (
                  <CommandItem
                    key={path}
                    value={`${getWorkspaceDisplayName(path, defaultWorkspaceName)} ${path}`}
                    data-checked={path === workspacePath}
                    aria-current={path === workspacePath ? 'true' : undefined}
                    disabled={switchingWorkspace}
                    onSelect={() => void switchWorkspace(path)}
                    className={cn(
                      'items-start [&>svg:last-child]:hidden',
                      path === workspacePath
                        ? 'text-foreground [&>svg:first-child]:text-primary'
                        : 'text-muted-foreground/70 [&>svg:first-child]:opacity-60'
                    )}
                  >
                    {path === workspacePath ? (
                      <FolderCheck className="mt-0.5" />
                    ) : (
                      <FolderOpen className="mt-0.5" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {getWorkspaceDisplayName(path, defaultWorkspaceName)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground/70">
                        {path}
                      </span>
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={tFile('workspace.removeHistory')}
                          className="-mr-1 text-muted-foreground hover:text-destructive"
                          onMouseDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                          onClick={(event) => handleRemoveWorkspace(event, path)}
                        >
                          <Trash2 />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {tFile('workspace.removeHistory')}
                      </TooltipContent>
                    </Tooltip>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

    </div>
  )
}
