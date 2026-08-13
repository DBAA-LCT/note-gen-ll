'use client'

import { BaseDirectory, readDir } from '@tauri-apps/plugin-fs'
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, CircleMinus, Database, FileText, Folder, GitCompareArrows, Loader2, Pencil, Plus, RefreshCcw, Save, Trash2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  deleteConnectorMapping,
  getEffectiveSyncPathPolicy,
  getConnectorMappings,
  saveConnectorMapping,
  type ConnectorSyncMapping,
  type SyncPathPolicy,
} from '@/lib/sync/connector-mappings'
import { getWorkspaceDisplayName } from '@/lib/workspace-name'
import type { SyncPlatform } from '@/types/sync'
import { listRemoteLibraryFilesForMapping } from '@/lib/sync/remote-library'
import { listRepositories } from '@/lib/sync/repository-check'
import { SYNC_REPO_PLATFORMS, type SyncRepoPlatform } from '@/lib/sync/workspace-repos'
import { cn } from '@/lib/utils'

interface ConnectorMappingTreeProps {
  platform: SyncPlatform
  workspaceOptions: string[]
  currentWorkspacePath: string
}

type MappingDraft = Omit<ConnectorSyncMapping, 'id' | 'platform'>

function emptyDraft(currentWorkspacePath: string): MappingDraft {
  return {
    localWorkspacePath: currentWorkspacePath,
    localPath: '',
    remoteTarget: '',
    remotePath: '',
    excludedPaths: [],
    pathPolicies: {},
    entryType: 'directory',
    accessMode: 'read-write',
    syncMode: 'manual',
    autoPullOnOpen: true,
    enabled: true,
  }
}

export function ConnectorMappingTree({
  platform,
  workspaceOptions,
  currentWorkspacePath,
}: ConnectorMappingTreeProps) {
  const t = useTranslations('settings.sync.mapping')
  const defaultWorkspaceName = useTranslations('settings.file.workspace')('defaultPath')
  const [mappings, setMappings] = useState<ConnectorSyncMapping[]>([])
  const [draft, setDraft] = useState<MappingDraft>(() => emptyDraft(currentWorkspacePath))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [saving, setSaving] = useState(false)
  const [remoteTargets, setRemoteTargets] = useState<string[]>([])
  const [loadingRemoteTargets, setLoadingRemoteTargets] = useState(false)
  const [remoteTargetError, setRemoteTargetError] = useState(false)
  const isGitPlatform = SYNC_REPO_PLATFORMS.includes(platform as SyncRepoPlatform)

  async function reload() {
    setMappings(await getConnectorMappings(platform))
  }

  useEffect(() => {
    setEditingId(null)
    setShowEditor(false)
    setDraft(emptyDraft(currentWorkspacePath))
    void reload()
  }, [currentWorkspacePath, platform])

  async function loadRemoteTargets() {
    if (!isGitPlatform) return
    setLoadingRemoteTargets(true)
    setRemoteTargetError(false)
    try {
      const result = await listRepositories(platform as SyncRepoPlatform)
      setRemoteTargets(result.repositories)
      setRemoteTargetError(result.status !== 'success')
    } finally {
      setLoadingRemoteTargets(false)
    }
  }

  useEffect(() => {
    if (showEditor && isGitPlatform) void loadRemoteTargets()
  }, [isGitPlatform, platform, showEditor])

  const groups = useMemo(() => {
    const grouped = new Map<string, ConnectorSyncMapping[]>()
    for (const mapping of mappings) {
      const entries = grouped.get(mapping.localWorkspacePath) || []
      entries.push(mapping)
      grouped.set(mapping.localWorkspacePath, entries)
    }
    return Array.from(grouped.entries()).map(([workspacePath, entries]) => ({
      workspacePath,
      entries: entries.sort((a, b) => a.localPath.localeCompare(b.localPath)),
    }))
  }, [mappings])

  function beginAdd() {
    setEditingId(null)
    setDraft(emptyDraft(currentWorkspacePath))
    setShowEditor(true)
  }

  function beginEdit(mapping: ConnectorSyncMapping) {
    const { id: _id, platform: _platform, ...nextDraft } = mapping
    setEditingId(mapping.id)
    setDraft({ ...nextDraft, accessMode: 'read-write' })
    setShowEditor(true)
  }

  async function handleSave() {
    if (!draft.remoteTarget.trim()) return
    setSaving(true)
    try {
      await saveConnectorMapping({
        ...draft,
        id: editingId || undefined,
        platform,
        entryType: 'directory',
        localPath: '',
      })
      await reload()
      setShowEditor(false)
      setEditingId(null)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(mapping: ConnectorSyncMapping) {
    await deleteConnectorMapping(platform, mapping.id)
    await reload()
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <GitCompareArrows className="size-4" />
              {t('title')}
            </CardTitle>
            <CardDescription>{t('description')}</CardDescription>
          </div>
          <Button type="button" size="sm" onClick={beginAdd}>
            <Plus data-icon="inline-start" />
            {t('add')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {showEditor ? (
          <div className="rounded-xl border bg-muted/15 p-4">
            <div className="mb-4">
              <div className="text-sm font-semibold">{editingId ? t('editMappingTitle') : t('addMappingTitle')}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t('formDescription')}</div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="rounded-lg border bg-background p-3">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Badge className="size-5 justify-center rounded-full p-0">1</Badge>
                  {t('chooseWorkspace')}
                </div>
                <div className="grid gap-3">
            <MappingField label={t('localWorkspace')} hint={t('localWorkspaceHint')}>
              <Select
                value={draft.localWorkspacePath || '__default__'}
                onValueChange={value => setDraft(current => ({
                  ...current,
                  localWorkspacePath: value === '__default__' ? '' : value,
                  localPath: '',
                }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {workspaceOptions.map(path => (
                    <SelectItem key={path || '__default__'} value={path || '__default__'}>
                      {getWorkspaceDisplayName(path, defaultWorkspaceName)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MappingField>
            <div className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
              {t('workspaceRootMappedHint')}
            </div>
                </div>
              </section>

              <section className="rounded-lg border bg-background p-3">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Badge className="size-5 justify-center rounded-full p-0">2</Badge>
                  {t('chooseRemoteLocation')}
                </div>
                <div className="grid gap-3">
            <MappingField label={isGitPlatform ? t('remoteRepository') : t('remoteTarget')} hint={t(`remoteTargetHint.${platform}`)}>
              {isGitPlatform ? (
                <div className="flex gap-2">
                  <Select
                    value={draft.remoteTarget || undefined}
                    onValueChange={value => setDraft(current => ({ ...current, remoteTarget: value }))}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={loadingRemoteTargets ? t('loadingRepositories') : t('selectRepository')} />
                    </SelectTrigger>
                    <SelectContent>
                      {draft.remoteTarget && !remoteTargets.includes(draft.remoteTarget) ? (
                        <SelectItem value={draft.remoteTarget}>{draft.remoteTarget}</SelectItem>
                      ) : null}
                      {remoteTargets.map(repository => (
                        <SelectItem key={repository} value={repository}>{repository}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="icon" disabled={loadingRemoteTargets} onClick={() => void loadRemoteTargets()} aria-label={t('refreshRepositories')}>
                    <RefreshCcw className={cn(loadingRemoteTargets && 'animate-spin')} />
                  </Button>
                </div>
              ) : (
                <Input
                  value={draft.remoteTarget}
                  onChange={event => setDraft(current => ({ ...current, remoteTarget: event.target.value }))}
                  placeholder={t(`remoteTargetPlaceholder.${platform}`)}
                />
              )}
              {remoteTargetError ? <div className="text-xs text-destructive">{t('repositoryListFailed')}</div> : null}
            </MappingField>
            <MappingField label={t('remotePathOptional')} hint={t('remotePathHint')}>
              <Input
                value={draft.remotePath}
                onChange={event => setDraft(current => ({ ...current, remotePath: event.target.value }))}
                placeholder={t('remotePathPlaceholder')}
              />
            </MappingField>
                </div>
              </section>
            </div>

            <div className="mt-4 flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-background px-3 py-2.5">
            <MappingField label={t('syncMode')} hint={t('syncModeHint')} className="min-w-44">
              <Select
                value={draft.syncMode}
                onValueChange={value => setDraft(current => ({
                  ...current,
                  syncMode: value as MappingDraft['syncMode'],
                }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="automatic">{t('automatic')}</SelectItem>
                  <SelectItem value="manual">{t('manual')}</SelectItem>
                </SelectContent>
              </Select>
            </MappingField>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowEditor(false)}>
                <X data-icon="inline-start" />{t('cancel')}
              </Button>
              <Button type="button" size="sm" disabled={saving || !draft.remoteTarget.trim()} onClick={() => void handleSave()}>
                <Save data-icon="inline-start" />{saving ? t('saving') : t('save')}
              </Button>
            </div>
            </div>
          </div>
        ) : null}

        {!groups.length ? (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            {t('empty')}
          </div>
        ) : groups.map(group => (
          <section key={group.workspacePath || '__default__'} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Folder className="size-4 text-muted-foreground" />
              {getWorkspaceDisplayName(group.workspacePath, defaultWorkspaceName)}
              <Badge variant="secondary">{group.entries.length}</Badge>
            </div>
            <div className="ml-2 border-l pl-3">
              {group.entries.map(mapping => {
                return (
                  <div
                    key={mapping.id}
                    className="border-b py-2 last:border-b-0"
                  >
                    <div className="flex flex-wrap items-center gap-2 px-1">
                    {mapping.entryType === 'file'
                      ? <FileText className="size-4 shrink-0 text-blue-500" />
                      : <Folder className="size-4 shrink-0 text-amber-500" />}
                    <div className="min-w-36 flex-1">
                      <div className="truncate text-sm font-medium">
                        {mapping.localPath || t('workspaceRoot')}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        → {mapping.remoteTarget}/{mapping.remotePath || t('remoteRoot')}
                      </div>
                    </div>
                    <Badge variant="outline">{mapping.syncMode === 'automatic' ? t('automatic') : t('manual')}</Badge>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => beginEdit(mapping)} aria-label={t('edit')}>
                      <Pencil />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => void handleDelete(mapping)} aria-label={t('delete')}>
                      <Trash2 />
                    </Button>
                    </div>
                    <MappingInventory
                      mapping={mapping}
                      onMappingChange={async next => {
                        await saveConnectorMapping(next)
                        await reload()
                      }}
                    />
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </CardContent>
    </Card>
  )
}

function MappingField({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1.5 text-sm font-medium', className)}>
      <span>{label}</span>
      {children}
      {hint ? <span className="text-xs font-normal leading-4 text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

type InventoryNode = {
  path: string
  name: string
  directory: boolean
  local: boolean
  remote: boolean
  children: InventoryNode[]
  root?: boolean
}

type InventoryResource = {
  path: string
  directory: boolean
}

function normalizeResourcePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

async function listWorkspaceResources(workspacePath: string): Promise<InventoryResource[]> {
  const resources: InventoryResource[] = []

  async function visit(relativePath: string) {
    const normalizedWorkspace = workspacePath.replace(/[\\/]+$/, '')
    const path = normalizedWorkspace
      ? `${normalizedWorkspace}/${relativePath}`.replace(/\/$/, '')
      : `article/${relativePath}`.replace(/\/$/, '')
    const entries = normalizedWorkspace
      ? await readDir(path)
      : await readDir(path, { baseDir: BaseDirectory.AppData })

    for (const entry of entries) {
      if (!entry.name || entry.name.startsWith('.') || entry.isSymlink) continue
      const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
      if (entry.isDirectory) {
        resources.push({ path: normalizeResourcePath(entryPath), directory: true })
        await visit(entryPath)
      } else if (entry.isFile) {
        resources.push({ path: normalizeResourcePath(entryPath), directory: false })
      }
    }
  }

  await visit('')
  return resources
}

function buildInventoryTree(mapping: ConnectorSyncMapping, localResources: InventoryResource[], remoteFiles: string[]): InventoryNode[] {
  const localRoot = normalizeResourcePath(mapping.localPath)
  const remoteRoot = normalizeResourcePath(mapping.remotePath)
  const resourceMap = new Map<string, { local: boolean; remote: boolean; directory: boolean }>()
  const isInside = (path: string, root: string) => !root || path === root || path.startsWith(`${root}/`)

  for (const resource of localResources) {
    const path = resource.path
    if (mapping.entryType === 'file' ? path !== localRoot : !isInside(path, localRoot)) continue
    if (mapping.entryType === 'directory' && path === localRoot && resource.directory) continue
    resourceMap.set(path, {
      ...(resourceMap.get(path) || { local: false, remote: false, directory: resource.directory }),
      local: true,
      directory: resource.directory,
    })
  }

  for (const rawPath of remoteFiles) {
    const remotePath = normalizeResourcePath(rawPath)
    if (mapping.entryType === 'file' && remoteRoot && remotePath !== remoteRoot) continue
    if (mapping.entryType === 'directory' && !isInside(remotePath, remoteRoot)) continue
    const suffix = mapping.entryType === 'file'
      ? ''
      : remotePath.slice(remoteRoot.length).replace(/^\/+/, '')
    const localPath = mapping.entryType === 'file'
      ? localRoot
      : [localRoot, suffix].filter(Boolean).join('/')
    if (!localPath) continue
    resourceMap.set(localPath, {
      ...(resourceMap.get(localPath) || { local: false, remote: false, directory: false }),
      remote: true,
      directory: false,
    })
  }

  const roots: InventoryNode[] = []
  const nodes = new Map<string, InventoryNode>()
  const relativeBase = mapping.entryType === 'file' ? localRoot.split('/').slice(0, -1).join('/') : localRoot

  for (const [path, presence] of resourceMap) {
    const relative = relativeBase && path.startsWith(`${relativeBase}/`)
      ? path.slice(relativeBase.length + 1)
      : path
    const segments = relative.split('/').filter(Boolean)
    let parentChildren = roots
    let accumulated = relativeBase

    segments.forEach((segment, index) => {
      accumulated = [accumulated, segment].filter(Boolean).join('/')
      const isTerminal = index === segments.length - 1
      const directory = !isTerminal || presence.directory
      let node = nodes.get(accumulated)
      if (!node) {
        node = {
          path: accumulated,
          name: segment,
          directory,
          local: false,
          remote: false,
          children: [],
        }
        nodes.set(accumulated, node)
        parentChildren.push(node)
      }
      if (isTerminal) {
        node.directory = presence.directory
        node.local ||= presence.local
        node.remote ||= presence.remote
      }
      parentChildren = node.children
    })
  }

  function finalize(items: InventoryNode[]): { local: boolean; remote: boolean } {
    items.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
    let local = false
    let remote = false
    for (const item of items) {
      if (item.directory) {
        const presence = finalize(item.children)
        item.local ||= presence.local
        item.remote ||= presence.remote
      }
      local ||= item.local
      remote ||= item.remote
    }
    return { local, remote }
  }
  finalize(roots)
  return roots
}

function MappingInventory({
  mapping,
  onMappingChange,
}: {
  mapping: ConnectorSyncMapping
  onMappingChange: (mapping: ConnectorSyncMapping) => Promise<void>
}) {
  const t = useTranslations('settings.sync.mapping')
  const [nodes, setNodes] = useState<InventoryNode[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [savingPath, setSavingPath] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function loadInventory() {
    setLoading(true)
    setError('')
    try {
      const [localResources, remoteFiles] = await Promise.all([
        listWorkspaceResources(mapping.localWorkspacePath),
        listRemoteLibraryFilesForMapping(mapping, { includeStaticAssets: true }),
      ])
      const children = buildInventoryTree(mapping, localResources, remoteFiles.map(file => file.path))
      const rootPath = normalizeResourcePath(mapping.localPath)
      const nextNodes: InventoryNode[] = [{
        path: rootPath,
        name: mapping.remoteTarget || t('remoteRoot'),
        directory: true,
        local: true,
        remote: true,
        root: true,
        children,
      }]
      setNodes(nextNodes)
      const initializedPolicies = { ...(mapping.pathPolicies || {}) }
      let policiesChanged = false
      const hasConfiguredPolicy = (path: string) => Object.keys(initializedPolicies).some(configuredPath => (
        !configuredPath || path === configuredPath || path.startsWith(`${configuredPath}/`)
      )) || (mapping.excludedPaths || []).some(excluded => path === excluded || path.startsWith(`${excluded}/`))
      const initializeLeaves = (items: InventoryNode[]) => items.forEach((item) => {
        if (item.directory) return initializeLeaves(item.children)
        if (hasConfiguredPolicy(item.path)) return
        const policy: SyncPathPolicy = item.remote && !item.local
          ? 'pull-only'
          : item.local && !item.remote
            ? 'local-only'
            : mapping.accessMode === 'read-only' ? 'pull-only' : 'sync'
        initializedPolicies[item.path] = policy
        policiesChanged = true
      })
      initializeLeaves(nextNodes)
      if (policiesChanged || mapping.accessMode === 'read-only') {
        void onMappingChange({ ...mapping, accessMode: 'read-write', pathPolicies: initializedPolicies })
      }
      // Keep large repositories compact until the user chooses what to inspect.
      setExpanded(new Set())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadInventory()
  }, [mapping.id, mapping.localWorkspacePath, mapping.localPath, mapping.remoteTarget, mapping.remotePath])

  const resourceCount = (() => {
    let count = 0
    const visit = (items: InventoryNode[]) => items.forEach((item) => {
      count += 1
      visit(item.children)
    })
    visit(nodes)
    return count
  })()
  async function setPathPolicy(path: string, policy: SyncPathPolicy) {
    setSavingPath(path)
    try {
      const pathPolicies = path
        ? Object.fromEntries(
            Object.entries(mapping.pathPolicies || {}).filter(([configuredPath]) => !configuredPath.startsWith(`${path}/`)),
          )
        : {}
      pathPolicies[path] = policy
      await onMappingChange({
        ...mapping,
        excludedPaths: path
          ? (mapping.excludedPaths || []).filter(excluded => excluded !== path && !excluded.startsWith(`${path}/`))
          : [],
        pathPolicies,
      })
    } finally {
      setSavingPath(null)
    }
  }

  function renderNode(node: InventoryNode, depth = 0): React.ReactNode {
    const isExpanded = expanded.has(node.path)
    const policy = getEffectiveSyncPathPolicy(mapping, node.path)
    const hasDescendantOverrides = Object.keys(mapping.pathPolicies || {}).some(configuredPath => (
      node.path
        ? configuredPath !== node.path && configuredPath.startsWith(`${node.path}/`)
        : configuredPath !== ''
    ))
    const customRepositoryPolicy = Boolean(node.root && hasDescendantOverrides)
    const inactive = policy === 'local-only' || policy === 'ignore-remote'
    const policies: SyncPathPolicy[] = ['local-only', 'pull-only', 'sync', 'ignore-remote']
    const policyLabels: Record<SyncPathPolicy, string> = {
      'local-only': t('policyLocalOnlyShort'),
      'pull-only': t('policyPullOnlyShort'),
      'sync': t('policySync'),
      'ignore-remote': t('policyIgnoreRemote'),
    }

    return (
      <div key={node.path}>
        <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_132px_160px] items-center gap-2 border-t border-border/60 px-3 text-xs transition-colors hover:bg-muted/35">
          <div className="relative flex min-w-0 items-center gap-1.5" style={{ paddingLeft: `${depth * 18}px` }}>
            {Array.from({ length: depth }, (_, guide) => (
              <span
                key={guide}
                aria-hidden
                className="pointer-events-none absolute inset-y-[-6px] border-l border-border/60"
                style={{ left: `${guide * 18 + 8}px` }}
              />
            ))}
            {node.directory ? (
              <button
                type="button"
                className="grid size-5 shrink-0 place-items-center rounded hover:bg-muted"
                onClick={() => setExpanded(current => {
                  const next = new Set(current)
                  if (next.has(node.path)) next.delete(node.path)
                  else next.add(node.path)
                  return next
                })}
              >
                {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </button>
            ) : <span className="size-5" />}
            <span className={cn('grid size-7 shrink-0 place-items-center rounded-md', node.root ? 'bg-violet-500/10' : node.directory ? 'bg-amber-500/10' : 'bg-blue-500/10')}>
              {node.root
                ? <Database className="size-4 text-violet-600" />
                : node.directory
                ? <Folder className="size-4 text-amber-600" />
                : <FileText className="size-4 text-blue-600" />}
            </span>
            <span className={inactive ? 'truncate text-muted-foreground' : 'truncate'} title={node.path}>{node.name}</span>
            {node.root ? <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{t('repository')}</Badge> : null}
            {node.root ? (
              <Badge
                variant="outline"
                className={cn(
                  'h-5 px-1.5 text-[10px]',
                  customRepositoryPolicy
                    ? 'border-amber-500/30 bg-amber-500/5 text-amber-700'
                    : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700',
                )}
              >
                {customRepositoryPolicy ? t('repositoryPolicyCustom') : t('repositoryPolicyUnified')}
              </Badge>
            ) : null}
            {savingPath === node.path ? <Loader2 className="size-3 animate-spin" /> : null}
          </div>
          <LocationCell local={node.local} remote={node.remote} localLabel={t('local')} remoteLabel={t('remote')} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(
                  'h-8 w-full justify-between rounded-lg bg-background px-3 text-xs font-medium shadow-none',
                  policy === 'sync' && 'border-emerald-500/35 bg-emerald-500/5 text-emerald-700',
                  policy === 'pull-only' && 'border-blue-500/30 bg-blue-500/5 text-blue-700',
                  inactive && 'text-muted-foreground',
                )}
                disabled={!mapping.enabled || savingPath !== null}
              >
                {customRepositoryPolicy ? t('repositoryPolicyCustom') : policyLabels[policy]}
                <ChevronDown className="size-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-72 max-w-[calc(100vw-1rem)]">
              {policies.map((choice) => {
                const available = isPolicyAvailable(node, choice)
                return (
                  <DropdownMenuItem
                    key={choice}
                    disabled={!available}
                    className="items-start gap-2 px-2 py-2"
                    onSelect={() => void setPathPolicy(node.path, choice)}
                  >
                    <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
                      {policy === choice ? <CheckCircle2 className="size-4 text-primary" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium">{policyLabels[choice]}</span>
                      <span className="block text-xs leading-4 text-muted-foreground">
                        {available ? t(`policyDescription.${choice}`) : t(`policyUnavailable.${choice}`)}
                      </span>
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {node.directory && isExpanded ? node.children.map(child => renderNode(child, depth + 1)) : null}
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-xl border bg-background shadow-sm">
      <div className="grid grid-cols-[minmax(0,1fr)_132px_160px] items-center gap-2 rounded-t-xl bg-muted/35 px-3 py-2 text-xs font-medium text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>{t('resource')}</span>
          <Badge variant="secondary">{resourceCount}</Badge>
        </div>
        <span>{t('location')}</span>
        <div className="flex items-center justify-between gap-1">
          <span>{t('syncPolicy')}</span>
          <Button type="button" variant="ghost" size="icon-sm" disabled={loading} onClick={() => void loadInventory()} aria-label={t('refreshTree')}>
            <RefreshCcw className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />{t('loadingTree')}
        </div>
      ) : error ? (
        <div className="px-3 py-5 text-sm text-destructive">{t('treeLoadFailed')}: {error}</div>
      ) : nodes.length ? nodes.map(node => renderNode(node)) : (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">{t('treeEmpty')}</div>
      )}
    </div>
  )
}

function isPolicyAvailable(node: InventoryNode, policy: SyncPathPolicy) {
  if (node.remote && !node.local) return policy === 'pull-only' || policy === 'sync' || policy === 'ignore-remote'
  if (node.local && !node.remote) return policy === 'local-only' || policy === 'sync'
  return policy === 'pull-only' || policy === 'sync'
}

function LocationCell({ local, remote, localLabel, remoteLabel }: { local: boolean; remote: boolean; localLabel: string; remoteLabel: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <PresenceChip present={local} label={localLabel} />
      <PresenceChip present={remote} label={remoteLabel} />
    </div>
  )
}

function PresenceChip({ present, label }: { present: boolean; label: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px]',
      present ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-700' : 'border-transparent bg-muted/60 text-muted-foreground/60',
    )}>
      {present ? <CheckCircle2 className="size-3" /> : <CircleMinus className="size-3" />}
      {label}
    </span>
  )
}
