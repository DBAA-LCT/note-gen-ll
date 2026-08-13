'use client'

import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getAgentEngineName, loadAgentEngineSettings, type AgentEngineId, type AgentEngineSettings } from '@/lib/agent-engines'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import useChatStore from '@/stores/chat'

export function AgentEngineIndicator() {
  const [engine, setEngine] = useState<AgentEngineId>('native')
  const loading = useChatStore(state => state.loading)
  const openSettings = useSettingsDialogStore(state => state.openSettings)

  useEffect(() => {
    void loadAgentEngineSettings().then(settings => setEngine(settings.selected))
    const handleChange = (event: Event) => {
      const settings = (event as CustomEvent<AgentEngineSettings>).detail
      if (settings?.selected) setEngine(settings.selected)
    }
    window.addEventListener('agent-engine-settings-changed', handleChange)
    return () => window.removeEventListener('agent-engine-settings-changed', handleChange)
  }, [])

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={loading}
      className="h-8 max-w-40 gap-1.5 px-2 text-xs text-muted-foreground"
      aria-label={`当前 Agent：${getAgentEngineName(engine)}`}
      title="点击配置 Agent 引擎"
      onClick={() => openSettings('agentEngines')}
    >
      <Bot className="size-4" />
      <span className="hidden max-w-28 truncate md:inline">{getAgentEngineName(engine)}</span>
    </Button>
  )
}
