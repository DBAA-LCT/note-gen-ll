'use client'

import { useEffect, useState } from 'react'
import { Bot, ChevronDown, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  AGENT_ENGINE_CATALOG,
  DEFAULT_AGENT_ENGINE_SETTINGS,
  getAgentEngineName,
  loadAgentEngineSettings,
  saveAgentEngineSettings,
  type AgentEngineId,
  type AgentEngineSettings,
} from '@/lib/agent-engines'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import useChatStore from '@/stores/chat'

export function AgentEngineIndicator() {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<AgentEngineSettings>(DEFAULT_AGENT_ENGINE_SETTINGS)
  const loading = useChatStore(state => state.loading)
  const openSettings = useSettingsDialogStore(state => state.openSettings)

  useEffect(() => {
    void loadAgentEngineSettings().then(setSettings)
    const handleChange = (event: Event) => {
      const nextSettings = (event as CustomEvent<AgentEngineSettings>).detail
      if (nextSettings?.selected) setSettings(nextSettings)
    }
    window.addEventListener('agent-engine-settings-changed', handleChange)
    return () => window.removeEventListener('agent-engine-settings-changed', handleChange)
  }, [])

  async function selectEngine(engine: AgentEngineId) {
    if (engine === settings.selected) {
      setOpen(false)
      return
    }

    const nextSettings = { ...settings, selected: engine }
    setSettings(nextSettings)
    setOpen(false)
    await saveAgentEngineSettings(nextSettings)
  }

  function manageEngines() {
    setOpen(false)
    openSettings('agentEngines')
  }

  const engineOptions = [
    { id: 'native' as const, name: 'NoteGoal 内置', description: '使用 NoteGoal 的模型配置', enabled: true },
    ...AGENT_ENGINE_CATALOG.map(item => ({
      id: item.id,
      name: item.name,
      description: item.description,
      enabled: settings.engines[item.id].installed,
    })),
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loading}
          className="h-8 max-w-44 gap-1.5 px-2 text-xs text-muted-foreground"
          aria-label={`当前 Agent：${getAgentEngineName(settings.selected)}`}
          title="切换 Agent 引擎"
        >
          <Bot className="size-4" />
          <span className="hidden max-w-28 truncate md:inline">
            {getAgentEngineName(settings.selected)}
          </span>
          <ChevronDown className="hidden size-3 md:block" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-72 p-0">
        <Command>
          <CommandList>
            <CommandGroup heading="Agent 引擎">
              {engineOptions.map(item => (
                <CommandItem
                  key={item.id}
                  value={`${item.name} ${item.id}`}
                  disabled={!item.enabled}
                  data-checked={settings.selected === item.id}
                  onSelect={() => void selectEngine(item.id)}
                  className="items-start"
                >
                  <Bot className="mt-0.5 size-4" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{item.name}</span>
                      {!item.enabled ? (
                        <span className="shrink-0 text-xs text-muted-foreground">未启用</span>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem value="管理 Agent 引擎 设置" onSelect={manageEngines}>
                <Settings className="size-4" />
                <span>管理 Agent 引擎</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
