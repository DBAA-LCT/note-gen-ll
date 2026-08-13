'use client'

import { useEffect, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DEFAULT_AGENT_ENGINE_SETTINGS,
  getAgentEngineName,
  loadAgentEngineSettings,
  type AgentEngineSettings,
} from '@/lib/agent-engines'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { AgentModelSelect } from './agent-model-select'
import { ChatToolsPopover } from './chat-tools-popover'
import { ExternalAgentPermission } from './external-agent-permission'
import { AgentEngineBadge } from './agent-engine-brand'

export function AgentComposerTools() {
  const [settings, setSettings] = useState<AgentEngineSettings>(DEFAULT_AGENT_ENGINE_SETTINGS)
  const openSettings = useSettingsDialogStore(state => state.openSettings)

  useEffect(() => {
    void loadAgentEngineSettings().then(setSettings)
    const handleChange = (event: Event) => {
      const next = (event as CustomEvent<AgentEngineSettings>).detail
      if (next?.selected) setSettings(next)
    }
    window.addEventListener('agent-engine-settings-changed', handleChange)
    return () => window.removeEventListener('agent-engine-settings-changed', handleChange)
  }, [])

  if (settings.selected === 'native') {
    return (
      <div className="flex min-w-0 items-center gap-0.5">
        <AgentEngineBadge engine="native" compact />
        <ChatToolsPopover />
      </div>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <AgentEngineBadge engine={settings.selected} compact />
      <AgentModelSelect />
      <ExternalAgentPermission />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground"
        title={`管理 ${getAgentEngineName(settings.selected)}`}
        aria-label={`管理 ${getAgentEngineName(settings.selected)}`}
        onClick={() => openSettings('agentEngines')}
      >
        <Settings2 className="size-4" />
      </Button>
    </div>
  )
}
