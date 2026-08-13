'use client'

import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DEFAULT_AGENT_ENGINE_SETTINGS,
  getAgentEngineName,
  listAgentEngineModels,
  loadAgentEngineSettings,
  saveAgentEngineSettings,
  type AgentEngineModel,
  type AgentEngineSettings,
  type ExternalAgentEngineId,
} from '@/lib/agent-engines'
import useChatStore from '@/stores/chat'
import { getDefaultArticleAbsolutePath, getWorkspacePath } from '@/lib/workspace'
import { ModelSelect } from './model-select'
import { AgentEngineMark } from './agent-engine-brand'

export function AgentModelSelect() {
  const [settings, setSettings] = useState<AgentEngineSettings>(DEFAULT_AGENT_ENGINE_SETTINGS)
  const [models, setModels] = useState<AgentEngineModel[]>([])
  const [customModel, setCustomModel] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const chatLoading = useChatStore(state => state.loading)

  useEffect(() => {
    void loadAgentEngineSettings().then(nextSettings => {
      setSettings(nextSettings)
      if (nextSettings.selected !== 'native') {
        setCustomModel(nextSettings.engines[nextSettings.selected].model || '')
      }
    })
    const handleChange = (event: Event) => {
      const nextSettings = (event as CustomEvent<AgentEngineSettings>).detail
      if (!nextSettings?.selected) return
      setSettings(nextSettings)
      setModels([])
      setError('')
      setCustomModel(nextSettings.selected === 'native' ? '' : nextSettings.engines[nextSettings.selected].model || '')
    }
    window.addEventListener('agent-engine-settings-changed', handleChange)
    return () => window.removeEventListener('agent-engine-settings-changed', handleChange)
  }, [])

  async function refreshModels(engine: ExternalAgentEngineId, currentSettings: AgentEngineSettings) {
    setLoadingModels(true)
    setError('')
    try {
      const engineSettings = currentSettings.engines[engine]
      const noteWorkspace = await getWorkspacePath()
      const workspace = engineSettings.workspace?.trim()
        || (noteWorkspace.isCustom ? noteWorkspace.path : await getDefaultArticleAbsolutePath(''))
      setModels(await listAgentEngineModels(engine, engineSettings.executable, workspace))
    } catch (reason) {
      setModels([])
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoadingModels(false)
    }
  }

  async function selectModel(model: string) {
    if (settings.selected === 'native') return
    const engine = settings.selected
    const normalizedModel = model.trim()
    const nextSettings: AgentEngineSettings = {
      ...settings,
      engines: {
        ...settings.engines,
        [engine]: {
          ...settings.engines[engine],
          model: normalizedModel || undefined,
        },
      },
    }
    setSettings(nextSettings)
    setCustomModel(normalizedModel)
    setOpen(false)
    await saveAgentEngineSettings(nextSettings)
  }

  if (settings.selected === 'native') {
    return <ModelSelect display="status" />
  }

  const engine = settings.selected
  const configuredModel = settings.engines[engine].model || ''
  const selectedModel = engine === 'workbuddy' && configuredModel === 'auto' ? '' : configuredModel
  const lastUsedModel = settings.engines[engine].lastUsedModel || ''
  const currentAgentModel = models.find(model => model.isCurrent)
  const baseModels = engine === 'workbuddy' ? models.filter(model => model.id !== 'auto') : models
  const visibleModels = selectedModel && !baseModels.some(model => model.id === selectedModel)
    ? [{ id: selectedModel, name: selectedModel }, ...baseModels]
    : baseModels
  const automaticLabel = lastUsedModel
    ? `${lastUsedModel}（自动）`
    : currentAgentModel
      ? `${currentAgentModel.name}（Agent 当前）`
      : `${getAgentEngineName(engine)} 默认模型`

  return (
    <Popover
      open={open}
      onOpenChange={nextOpen => {
        setOpen(nextOpen)
        if (nextOpen) void refreshModels(engine, settings)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          disabled={chatLoading}
          className="h-7 min-w-0 max-w-44 gap-1 px-1.5 text-xs font-normal text-muted-foreground"
          title={`切换 ${getAgentEngineName(engine)} 模型`}
        >
          <AgentEngineMark engine={engine} className="size-4 rounded-[4px]" />
          <span className="truncate">
            {selectedModel || automaticLabel}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[360px] p-0">
        <Command>
          <CommandInput placeholder={`搜索 ${getAgentEngineName(engine)} 可用模型…`} className="h-9" />
          <CommandList>
            <CommandEmpty>{loadingModels ? '正在读取 Agent 账号模型…' : '没有读取到可用模型'}</CommandEmpty>
            <CommandGroup heading={`${getAgentEngineName(engine)} 模型`}>
              <CommandItem
                value="CLI 默认模型 default"
                data-checked={!selectedModel}
                onSelect={() => void selectModel('')}
              >
                <div className="min-w-0">
                  <div className="font-medium">跟随 Agent 自动选择</div>
                  {lastUsedModel ? (
                    <div className="truncate text-xs text-muted-foreground">上次实际使用：{lastUsedModel}</div>
                  ) : currentAgentModel ? (
                    <div className="truncate text-xs text-muted-foreground">Agent 当前设置：{currentAgentModel.name}</div>
                  ) : null}
                </div>
              </CommandItem>
              {visibleModels.map(model => (
                <CommandItem
                  key={model.id}
                  value={`${model.name} ${model.id}`}
                  data-checked={selectedModel === model.id}
                  onSelect={() => void selectModel(model.id)}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{model.name}</div>
                    {model.name !== model.id ? (
                      <div className="truncate text-xs text-muted-foreground">{model.id}</div>
                    ) : null}
                    {model.description ? <div className="truncate text-xs text-muted-foreground">{model.description}</div> : null}
                  </div>
                  {model.isCurrent ? <span className="ml-auto shrink-0 text-xs text-emerald-600">当前</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
            {loadingModels ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" />正在连接 Agent 并读取账号模型…
              </div>
            ) : null}
            {error ? <div className="px-3 py-2 text-xs text-destructive">{error}</div> : null}
          </CommandList>
          <CommandSeparator />
          <form
            className="flex gap-2 p-2"
            onSubmit={event => {
              event.preventDefault()
              if (customModel.trim()) void selectModel(customModel)
            }}
          >
            <Input
              value={customModel}
              onChange={event => setCustomModel(event.target.value)}
              placeholder="手动输入模型 ID"
              className="h-8 text-xs"
            />
            <Button type="submit" size="sm" className="h-8" disabled={!customModel.trim()}>
              使用
            </Button>
          </form>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
