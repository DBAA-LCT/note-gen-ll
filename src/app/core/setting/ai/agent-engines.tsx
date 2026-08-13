'use client'
import { useCallback, useEffect, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Bot, Check, ExternalLink, FolderOpen, LoaderCircle, Power, RefreshCw, RotateCcw } from 'lucide-react'
import { AGENT_ENGINE_CATALOG, DEFAULT_AGENT_ENGINE_SETTINGS, inspectAgentEngine, loadAgentEngineSettings, saveAgentEngineSettings, type AgentEngineInspection, type AgentEngineSettings, type ExternalAgentEngineId } from '@/lib/agent-engines'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export default function AgentEngines() {
  const [settings, setSettings] = useState<AgentEngineSettings>(DEFAULT_AGENT_ENGINE_SETTINGS)
  const [inspections, setInspections] = useState<Partial<Record<ExternalAgentEngineId, AgentEngineInspection>>>({})
  const [checking, setChecking] = useState<ExternalAgentEngineId | null>(null)
  useEffect(() => { void loadAgentEngineSettings().then(setSettings) }, [])
  const commit = useCallback(async (next: AgentEngineSettings) => { setSettings(next); await saveAgentEngineSettings(next) }, [])
  const inspect = useCallback(async (id: ExternalAgentEngineId, executable?: string) => {
    setChecking(id)
    try { const result = await inspectAgentEngine(id, executable); setInspections(current => ({ ...current, [id]: result })) } finally { setChecking(null) }
  }, [])
  const selectWorkspace = useCallback(async (id: ExternalAgentEngineId) => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: `选择 ${AGENT_ENGINE_CATALOG.find(item => item.id === id)?.name || id} 工作目录`,
    })
    if (typeof selected !== 'string') return
    const next = {
      ...settings,
      engines: {
        ...settings.engines,
        [id]: { ...settings.engines[id], workspace: selected },
      },
    }
    await commit(next)
  }, [commit, settings])
  return <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><Bot className="size-5" />Agent 引擎插件</CardTitle>
      <CardDescription>启用后可切换到 OpenCode、Claude Code、Codex 或 WorkBuddy。模型、账号和服务地址使用对应软件的本地配置。</CardDescription>
      <CardAction><Badge variant="outline">当前：{settings.selected === 'native' ? 'NoteGoal 内置' : settings.selected}</Badge></CardAction>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div><div className="font-medium">NoteGoal 内置 Agent</div><div className="text-sm text-muted-foreground">无需外部 CLI，保留为故障回退</div></div>
        <Button variant={settings.selected === 'native' ? 'secondary' : 'outline'} onClick={() => void commit({ ...settings, selected: 'native' })}>{settings.selected === 'native' ? <Check /> : null}使用</Button>
      </div>
      {AGENT_ENGINE_CATALOG.map(item => {
        const config = settings.engines[item.id]; const status = inspections[item.id]
        return <div key={item.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><div className="font-medium">{item.name}</div><div className="text-sm text-muted-foreground">{item.description}</div></div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => void openUrl(item.installUrl)}><ExternalLink />安装 CLI</Button>
              <Button size="sm" variant="outline" disabled={checking === item.id} onClick={() => void inspect(item.id, config.executable)}>{checking === item.id ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}检测</Button>
              {!config.installed ? <Button size="sm" onClick={() => void commit({ ...settings, engines: { ...settings.engines, [item.id]: { ...config, installed: true } } })}><Power />启用适配器</Button>
                : <Button size="sm" variant={settings.selected === item.id ? 'secondary' : 'default'} disabled={status?.available === false} onClick={() => void commit({ ...settings, selected: item.id })}>{settings.selected === item.id ? <Check /> : null}使用</Button>}
            </div>
          </div>
          {config.installed ? <div className="mt-3 space-y-2">
            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <Input value={config.executable || ''} placeholder={`可选：${item.id} 可执行文件完整路径`} onChange={event => setSettings(current => ({ ...current, engines: { ...current.engines, [item.id]: { ...current.engines[item.id], executable: event.target.value } } }))} onBlur={() => void commit(settings)} />
              <Button variant="ghost" onClick={() => void commit({ ...settings, engines: { ...settings.engines, [item.id]: { ...config, permissionMode: config.permissionMode === 'workspace-write' ? 'read-only' : 'workspace-write' } } })}>{config.permissionMode === 'workspace-write' ? '可写工作区' : '只读模式'}</Button>
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
              <Input
                value={config.workspace || ''}
                readOnly
                title={config.workspace || '使用 NoteGoal 当前工作区'}
                placeholder="使用 NoteGoal 当前工作区"
              />
              <Button variant="outline" onClick={() => void selectWorkspace(item.id)}>
                <FolderOpen />选择项目
              </Button>
              <Button
                variant="ghost"
                disabled={!config.workspace}
                title="恢复为 NoteGoal 当前工作区"
                onClick={() => void commit({
                  ...settings,
                  engines: {
                    ...settings.engines,
                    [item.id]: { ...config, workspace: undefined },
                  },
                })}
              >
                <RotateCcw />跟随 NoteGoal
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Agent 会从这个目录加载项目级 Skills、插件、规则和 MCP；用户级配置仍从本机对应 CLI 读取。
            </p>
          </div> : null}
          {status ? <div className={`mt-2 break-all text-sm ${status.available ? 'text-emerald-600' : 'text-destructive'}`}>{status.available ? `CLI 可用${status.version ? ` · ${status.version}` : ''}${status.executable ? ` · ${status.executable}` : ''}` : `CLI 不可用${status.error ? ` · ${status.error}` : ''}`}</div> : null}
        </div>
      })}
    </CardContent>
  </Card>
}
