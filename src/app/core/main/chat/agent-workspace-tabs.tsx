'use client'

import { useCallback, useEffect, useState } from 'react'
import { LoaderCircle, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
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

const TAB_LABELS: Record<AgentEngineId, string> = {
  native: '聊天',
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  workbuddy: 'WorkBuddy',
}

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

  const tabs: AgentEngineId[] = ['native', 'claude', 'codex', 'opencode', 'workbuddy']

  return (
    <div className="flex h-11 w-full shrink-0 items-stretch border-b bg-background/95">
      <div className="flex min-w-0 flex-1 overflow-x-auto px-2 scrollbar-hide">
        {tabs.map(engine => {
          const active = settings.selected === engine
          const available = engine === 'native' || inspections[engine]?.available === true
          const engineChecking = engine !== 'native' && checking && !inspections[engine]
          return (
            <button
              key={engine}
              type="button"
              disabled={loading || !available || engineChecking}
              onClick={() => void selectEngine(engine)}
              className={cn(
                'relative flex h-11 shrink-0 items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45',
                active && 'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary'
              )}
              title={available ? `切换到 ${TAB_LABELS[engine]}` : `${TAB_LABELS[engine]} 离线，请先安装或检测 CLI`}
            >
              {engineChecking ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <span className={cn('size-1.5 rounded-full', available ? 'bg-emerald-500' : 'bg-muted-foreground/35')} />
              )}
              <span>{TAB_LABELS[engine]}</span>
            </button>
          )
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="m-1.5 size-8 shrink-0 text-muted-foreground"
        title="管理 Agent 引擎"
        aria-label="管理 Agent 引擎"
        onClick={() => openSettings('agentEngines')}
      >
        <Settings className="size-4" />
      </Button>
    </div>
  )
}
