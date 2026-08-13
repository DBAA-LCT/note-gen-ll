"use client"

import { useEffect, useState } from "react"
import { AgentModelSelect } from "./agent-model-select"
import { PromptSelect } from "./prompt-select"
import {
  DEFAULT_AGENT_ENGINE_SETTINGS,
  loadAgentEngineSettings,
  type AgentEngineSettings,
} from "@/lib/agent-engines"

export function ChatFooter() {
  const [settings, setSettings] = useState<AgentEngineSettings>(DEFAULT_AGENT_ENGINE_SETTINGS)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void loadAgentEngineSettings().then(next => {
      setSettings(next)
      setReady(true)
    })
    const handleChange = (event: Event) => {
      const next = (event as CustomEvent<AgentEngineSettings>).detail
      if (next?.selected) {
        setSettings(next)
        setReady(true)
      }
    }
    window.addEventListener('agent-engine-settings-changed', handleChange)
    return () => window.removeEventListener('agent-engine-settings-changed', handleChange)
  }, [])

  if (!ready || settings.selected !== 'native') return null

  return (
    <footer className="flex h-6 w-full items-center justify-between border-t border-border bg-background px-1 text-xs text-muted-foreground">
      <AgentModelSelect />
      <PromptSelect display="status" />
    </footer>
  )
}
