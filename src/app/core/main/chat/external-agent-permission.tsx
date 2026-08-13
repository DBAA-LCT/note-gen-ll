'use client'

import { useEffect, useState } from 'react'
import { Eye, PencilLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ResponsiveActionMenu } from '@/components/responsive-action-menu'
import {
  DEFAULT_AGENT_ENGINE_SETTINGS,
  loadAgentEngineSettings,
  saveAgentEngineSettings,
  type AgentEngineSettings,
} from '@/lib/agent-engines'
import useChatStore from '@/stores/chat'

export function ExternalAgentPermission() {
  const [settings, setSettings] = useState<AgentEngineSettings>(DEFAULT_AGENT_ENGINE_SETTINGS)
  const loading = useChatStore(state => state.loading)

  useEffect(() => {
    void loadAgentEngineSettings().then(setSettings)
    const handleChange = (event: Event) => {
      const next = (event as CustomEvent<AgentEngineSettings>).detail
      if (next?.selected) setSettings(next)
    }
    window.addEventListener('agent-engine-settings-changed', handleChange)
    return () => window.removeEventListener('agent-engine-settings-changed', handleChange)
  }, [])

  if (settings.selected === 'native') return null
  const engine = settings.selected
  const mode = settings.engines[engine].permissionMode
  const Icon = mode === 'read-only' ? Eye : PencilLine

  async function selectMode(nextMode: 'workspace-write' | 'read-only') {
    if (settings.selected === 'native') return
    const next: AgentEngineSettings = {
      ...settings,
      engines: {
        ...settings.engines,
        [settings.selected]: { ...settings.engines[settings.selected], permissionMode: nextMode },
      },
    }
    setSettings(next)
    await saveAgentEngineSettings(next)
  }

  return (
    <ResponsiveActionMenu
      title="Agent 权限"
      desktopClassName="w-72"
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={loading}
          className="size-7 shrink-0 text-muted-foreground"
          title="切换 Agent 工作区权限"
          aria-label={mode === 'read-only' ? 'Agent 权限：只读' : 'Agent 权限：可编辑工作区'}
        >
          <Icon className="size-4" />
        </Button>
      }
      items={[
        {
          key: 'workspace-write',
          icon: <PencilLine />,
          label: (
            <span className="flex flex-col items-start">
              <span>可编辑工作区</span>
              <span className="text-xs text-muted-foreground">允许 Agent 修改当前项目文件</span>
            </span>
          ),
          selected: mode === 'workspace-write',
          onSelect: () => void selectMode('workspace-write'),
        },
        {
          key: 'read-only',
          icon: <Eye />,
          label: (
            <span className="flex flex-col items-start">
              <span>只读</span>
              <span className="text-xs text-muted-foreground">只允许分析，不修改文件</span>
            </span>
          ),
          selected: mode === 'read-only',
          onSelect: () => void selectMode('read-only'),
        },
      ]}
    />
  )
}
