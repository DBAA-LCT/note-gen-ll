'use client'

import { useEffect, useState } from 'react'
import {
  DEFAULT_AGENT_ENGINE_SETTINGS,
  loadAgentEngineSettings,
  type AgentEngineSettings,
} from '@/lib/agent-engines'
import { AgentModelSelect } from './agent-model-select'
import { ChatToolsPopover } from './chat-tools-popover'
import { ExternalAgentPermission } from './external-agent-permission'

export function AgentComposerTools() {
  const [settings, setSettings] = useState<AgentEngineSettings>(DEFAULT_AGENT_ENGINE_SETTINGS)

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
    return <ChatToolsPopover />
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
      <AgentModelSelect />
      <ExternalAgentPermission />
    </div>
  )
}
