'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, FolderOpen, LoaderCircle, Settings } from 'lucide-react'
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
  getAgentWorkspaceName,
  inspectAgentEngine,
  loadAgentEngineSettings,
  saveAgentEngineSettings,
  type AgentEngineId,
  type AgentEngineInspection,
  type AgentEngineSettings,
  type ExternalAgentEngineId,
} from '@/lib/agent-engines'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import useChatStore from '@/stores/chat'
import { AgentEngineMark } from './agent-engine-brand'

export function AgentEngineIndicator() {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<AgentEngineSettings>(DEFAULT_AGENT_ENGINE_SETTINGS)
  const [inspections, setInspections] = useState<Partial<Record<ExternalAgentEngineId, AgentEngineInspection>>>({})
  const [checking, setChecking] = useState(false)
  const loading = useChatStore(state => state.loading)
  const openSettings = useSettingsDialogStore(state => state.openSettings)

  const refreshAvailability = useCallback(async (currentSettings: AgentEngineSettings) => {
    setChecking(true)
    const results = await Promise.all(AGENT_ENGINE_CATALOG.map(async item => {
      try {
        return await inspectAgentEngine(item.id, currentSettings.engines[item.id].executable)
      } catch (error) {
        return {
          engine: item.id,
          available: false,
          error: String(error),
        } satisfies AgentEngineInspection
      }
    }))

    const nextInspections = Object.fromEntries(
      results.map(result => [result.engine, result])
    ) as Record<ExternalAgentEngineId, AgentEngineInspection>
    setInspections(nextInspections)
    setChecking(false)

    if (currentSettings.selected !== 'native' && !nextInspections[currentSettings.selected].available) {
      const fallbackSettings = { ...currentSettings, selected: 'native' as const }
      setSettings(fallbackSettings)
      await saveAgentEngineSettings(fallbackSettings)
    }
  }, [])

  useEffect(() => {
    void loadAgentEngineSettings().then(loadedSettings => {
      setSettings(loadedSettings)
      void refreshAvailability(loadedSettings)
    })
    const handleChange = (event: Event) => {
      const nextSettings = (event as CustomEvent<AgentEngineSettings>).detail
      if (nextSettings?.selected) {
        setSettings(nextSettings)
        void refreshAvailability(nextSettings)
      }
    }
    window.addEventListener('agent-engine-settings-changed', handleChange)
    return () => window.removeEventListener('agent-engine-settings-changed', handleChange)
  }, [refreshAvailability])

  async function selectEngine(engine: AgentEngineId) {
    if (engine === settings.selected) {
      setOpen(false)
      return
    }

    const nextSettings: AgentEngineSettings = engine === 'native'
      ? { ...settings, selected: engine }
      : {
          ...settings,
          selected: engine,
          engines: {
            ...settings.engines,
            [engine]: { ...settings.engines[engine], installed: true },
          },
        }
    setSettings(nextSettings)
    setOpen(false)
    await saveAgentEngineSettings(nextSettings)
  }

  function manageEngines() {
    setOpen(false)
    openSettings('agentEngines')
  }

  const engineOptions = [
    {
      id: 'native' as const,
      name: 'NoteGoal 内置',
      description: '在线 · 使用 NoteGoal 的模型配置',
      available: true,
      checking: false,
    },
    ...AGENT_ENGINE_CATALOG.map(item => ({
      id: item.id,
      name: item.name,
      description: checking && !inspections[item.id]
        ? '正在检测本机 CLI…'
        : inspections[item.id]?.available
          ? `在线${inspections[item.id]?.version ? ` · ${inspections[item.id]?.version}` : ''}`
          : '离线 · 未检测到可用 CLI',
      available: inspections[item.id]?.available === true,
      checking: checking && !inspections[item.id],
      workspaceName: getAgentWorkspaceName(settings.engines[item.id].workspace),
    })),
  ]

  const selectedWorkspace = settings.selected === 'native'
    ? ''
    : getAgentWorkspaceName(settings.engines[settings.selected].workspace)

  return (
    <Popover
      open={open}
      onOpenChange={nextOpen => {
        setOpen(nextOpen)
        if (nextOpen) void refreshAvailability(settings)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loading}
          className="h-8 max-w-64 gap-1.5 px-2 text-xs text-muted-foreground"
          aria-label={`当前 Agent：${getAgentEngineName(settings.selected)}`}
          title="切换 Agent 引擎"
        >
          <AgentEngineMark engine={settings.selected} className="size-4 rounded-[4px]" />
          <span className="hidden max-w-28 truncate md:inline">
            {getAgentEngineName(settings.selected)}
          </span>
          {selectedWorkspace ? (
            <span className="hidden min-w-0 items-center gap-1 border-l pl-1.5 lg:flex" title={settings.engines[settings.selected as ExternalAgentEngineId].workspace || 'NoteGoal 当前工作区'}>
              <FolderOpen className="size-3" />
              <span className="max-w-24 truncate">{selectedWorkspace}</span>
            </span>
          ) : null}
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
                  disabled={!item.available || item.checking}
                  data-checked={settings.selected === item.id}
                  onSelect={() => void selectEngine(item.id)}
                  className="items-start"
                >
                  <AgentEngineMark engine={item.id} className="mt-0.5 size-5 rounded-[5px]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{item.name}</span>
                      {item.checking ? (
                        <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                      ) : (
                        <span
                          className={`size-2 shrink-0 rounded-full ${item.available ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`}
                          aria-label={item.available ? '在线' : '离线'}
                        />
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                    {'workspaceName' in item ? (
                      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <FolderOpen className="size-3 shrink-0" />
                        <span className="truncate">{item.workspaceName}</span>
                      </p>
                    ) : null}
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
