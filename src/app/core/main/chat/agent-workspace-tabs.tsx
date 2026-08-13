'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, LoaderCircle, MoreHorizontal, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AGENT_ENGINE_CATALOG,
  DEFAULT_AGENT_ENGINE_SETTINGS,
  inspectAgentEngine,
  loadAgentEngineConversations,
  loadAgentEngineSettings,
  saveAgentEngineConversation,
  saveAgentEngineSettings,
  type AgentEngineId,
  type AgentEngineInspection,
  type AgentEngineSettings,
  type ExternalAgentEngineId,
} from '@/lib/agent-engines'
import useChatStore from '@/stores/chat'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { AGENT_ENGINE_VISUALS, AgentEngineMark } from './agent-engine-brand'

export function AgentWorkspaceTabs() {
  const [settings, setSettings] = useState<AgentEngineSettings>(DEFAULT_AGENT_ENGINE_SETTINGS)
  const [inspections, setInspections] = useState<Partial<Record<ExternalAgentEngineId, AgentEngineInspection>>>({})
  const [checking, setChecking] = useState(true)
  const loading = useChatStore(state => state.loading)
  const currentConversationId = useChatStore(state => state.currentConversationId)
  const switchConversation = useChatStore(state => state.switchConversation)
  const startNewConversation = useChatStore(state => state.startNewConversation)
  const openSettings = useSettingsDialogStore(state => state.openSettings)

  const inspectEngines = useCallback(async (currentSettings: AgentEngineSettings) => {
    setChecking(true)
    const results = await Promise.all(AGENT_ENGINE_CATALOG.map(async item => {
      try {
        return await inspectAgentEngine(item.id, currentSettings.engines[item.id].executable)
      } catch (error) {
        return { engine: item.id, available: false, error: String(error) } satisfies AgentEngineInspection
      }
    }))
    const next = Object.fromEntries(results.map(result => [result.engine, result])) as Record<ExternalAgentEngineId, AgentEngineInspection>
    setInspections(next)
    setChecking(false)

    if (currentSettings.selected !== 'native' && !next[currentSettings.selected]?.available) {
      const fallback = { ...currentSettings, selected: 'native' as const }
      setSettings(fallback)
      await saveAgentEngineSettings(fallback)
    }
  }, [])

  useEffect(() => {
    void loadAgentEngineSettings().then(async loaded => {
      setSettings(loaded)
      void inspectEngines(loaded)
      const conversations = await loadAgentEngineConversations()
      const targetConversation = conversations[loaded.selected]
      if (targetConversation && targetConversation !== useChatStore.getState().currentConversationId) {
        await switchConversation(targetConversation).catch(async () => {
          await saveAgentEngineConversation(loaded.selected, null)
        })
      } else if (!targetConversation && useChatStore.getState().currentConversationId) {
        await saveAgentEngineConversation(loaded.selected, useChatStore.getState().currentConversationId)
      }
    })
    const handleChange = (event: Event) => {
      const next = (event as CustomEvent<AgentEngineSettings>).detail
      if (!next?.selected) return
      setSettings(next)
    }
    window.addEventListener('agent-engine-settings-changed', handleChange)
    return () => window.removeEventListener('agent-engine-settings-changed', handleChange)
  }, [inspectEngines, switchConversation])

  useEffect(() => {
    if (!currentConversationId) return
    void saveAgentEngineConversation(settings.selected, currentConversationId)
  }, [currentConversationId, settings.selected])

  async function selectEngine(engine: AgentEngineId) {
    if (loading || engine === settings.selected) return
    if (engine !== 'native' && !inspections[engine]?.available) return
    if (currentConversationId) await saveAgentEngineConversation(settings.selected, currentConversationId)
    const conversations = await loadAgentEngineConversations()
    const next: AgentEngineSettings = engine === 'native'
      ? { ...settings, selected: engine }
      : {
          ...settings,
          selected: engine,
          engines: {
            ...settings.engines,
            [engine]: { ...settings.engines[engine], installed: true },
          },
        }
    setSettings(next)
    await saveAgentEngineSettings(next)
    const targetConversation = conversations[engine]
    if (targetConversation) {
      await switchConversation(targetConversation).catch(async () => {
        await saveAgentEngineConversation(engine, null)
        await startNewConversation()
      })
    } else {
      await startNewConversation()
    }
  }

  const onlineEngines = AGENT_ENGINE_CATALOG
    .map(item => item.id)
    .filter(engine => inspections[engine]?.available === true)
  const visibleTabs: AgentEngineId[] = settings.selected === 'native'
    ? ['native']
    : ['native', settings.selected]

  return (
    <div className="flex h-11 w-full shrink-0 items-stretch border-b bg-background/95">
      <div className="flex min-w-0 flex-1 overflow-x-auto px-2 scrollbar-hide">
        {visibleTabs.map(engine => {
          const active = settings.selected === engine
          const visual = AGENT_ENGINE_VISUALS[engine]
          return (
            <button
              key={engine}
              type="button"
              disabled={loading}
              onClick={() => void selectEngine(engine)}
              className={cn(
                'relative flex h-11 shrink-0 items-center gap-2 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45',
                active && `text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full ${visual.activeClassName}`
              )}
              title={`切换到 ${visual.label}`}
            >
              <AgentEngineMark engine={engine} />
              <span>{visual.label}</span>
            </button>
          )
        })}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="m-1.5 size-8 shrink-0 text-muted-foreground"
            title="切换 Agent"
            aria-label="切换 Agent"
            disabled={loading}
          >
            {checking ? <LoaderCircle className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground">在线 Agent</DropdownMenuLabel>
          {onlineEngines.length ? onlineEngines.map(engine => {
            const visual = AGENT_ENGINE_VISUALS[engine]
            return (
              <DropdownMenuItem key={engine} onSelect={() => void selectEngine(engine)} className="gap-2 py-2">
                <AgentEngineMark engine={engine} />
                <span className="min-w-0 flex-1 truncate font-medium">{visual.label}</span>
                {settings.selected === engine ? <Check className="size-4 text-primary" /> : null}
              </DropdownMenuItem>
            )
          }) : (
            <DropdownMenuItem disabled>暂未检测到在线的外部 Agent</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openSettings('agentEngines')} className="gap-2">
            <Settings className="size-4" />
            <span>管理 Agent 引擎</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
