import { invoke } from '@tauri-apps/api/core'
import { Store } from '@tauri-apps/plugin-store'

export type AgentEngineId = 'native' | 'opencode' | 'claude' | 'codex' | 'workbuddy'
export type ExternalAgentEngineId = Exclude<AgentEngineId, 'native'>
export interface AgentEngineConfig { installed: boolean; executable?: string; model?: string; lastUsedModel?: string; workspace?: string; permissionMode: 'workspace-write' | 'read-only' }
export interface AgentEngineSettings { selected: AgentEngineId; engines: Record<ExternalAgentEngineId, AgentEngineConfig> }
export interface AgentEngineInspection { engine: ExternalAgentEngineId; available: boolean; executable?: string; version?: string; error?: string }
export interface AgentEngineModel { id: string; name: string; description?: string; isCurrent?: boolean }
export interface AgentEngineCommand { name: string; description: string; argumentHint?: string; source: 'builtin' | 'claude' | 'personal' | 'project' | string }

const STORE_KEY = 'agentEngines.v1'
const CONVERSATION_STORE_KEY = 'agentEngineConversations.v1'
export const AGENT_ENGINE_CATALOG = [
  { id: 'opencode', name: 'OpenCode', description: '开源、可定制的本地编码 Agent', installUrl: 'https://opencode.ai/docs/' },
  { id: 'claude', name: 'Claude Code', description: 'Anthropic 官方本地 Agent', installUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview' },
  { id: 'codex', name: 'Codex', description: 'OpenAI 官方本地编码 Agent', installUrl: 'https://developers.openai.com/codex/cli/' },
  { id: 'workbuddy', name: 'WorkBuddy', description: '腾讯 WorkBuddy 自带的 CodeBuddy CLI', installUrl: 'https://www.workbuddy.ai/' },
] satisfies Array<{ id: ExternalAgentEngineId; name: string; description: string; installUrl: string }>
export const DEFAULT_AGENT_ENGINE_SETTINGS: AgentEngineSettings = {
  selected: 'native', engines: {
    opencode: { installed: false, permissionMode: 'workspace-write' },
    claude: { installed: false, permissionMode: 'workspace-write' },
    codex: { installed: false, permissionMode: 'workspace-write' },
    workbuddy: { installed: false, permissionMode: 'workspace-write' },
  },
}

export async function loadAgentEngineSettings(): Promise<AgentEngineSettings> {
  const store = await Store.load('store.json')
  const saved = await store.get<Partial<AgentEngineSettings>>(STORE_KEY)
  return { ...DEFAULT_AGENT_ENGINE_SETTINGS, ...saved, engines: {
    opencode: { ...DEFAULT_AGENT_ENGINE_SETTINGS.engines.opencode, ...saved?.engines?.opencode },
    claude: { ...DEFAULT_AGENT_ENGINE_SETTINGS.engines.claude, ...saved?.engines?.claude },
    codex: { ...DEFAULT_AGENT_ENGINE_SETTINGS.engines.codex, ...saved?.engines?.codex },
    workbuddy: { ...DEFAULT_AGENT_ENGINE_SETTINGS.engines.workbuddy, ...saved?.engines?.workbuddy },
  } }
}
export async function saveAgentEngineSettings(settings: AgentEngineSettings) {
  const store = await Store.load('store.json'); await store.set(STORE_KEY, settings); await store.save()
  window.dispatchEvent(new CustomEvent('agent-engine-settings-changed', { detail: settings }))
}
export async function loadAgentEngineConversations(): Promise<Partial<Record<AgentEngineId, number>>> {
  const store = await Store.load('store.json')
  return await store.get<Partial<Record<AgentEngineId, number>>>(CONVERSATION_STORE_KEY) || {}
}
export async function saveAgentEngineConversation(engine: AgentEngineId, conversationId: number | null) {
  const store = await Store.load('store.json')
  const conversations = await store.get<Partial<Record<AgentEngineId, number>>>(CONVERSATION_STORE_KEY) || {}
  if (conversationId == null) delete conversations[engine]
  else conversations[engine] = conversationId
  await store.set(CONVERSATION_STORE_KEY, conversations)
  await store.save()
}

export function getAgentEngineName(engine: AgentEngineId) {
  if (engine === 'native') return 'NoteGoal 内置'
  return AGENT_ENGINE_CATALOG.find(item => item.id === engine)?.name || engine
}
export function getAgentWorkspaceName(path?: string) {
  const normalized = path?.trim().replace(/[\\/]+$/, '')
  if (!normalized) return 'NoteGoal 工作区'
  return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized
}
export async function inspectAgentEngine(engine: ExternalAgentEngineId, executable?: string) {
  return invoke<AgentEngineInspection>('inspect_agent_engine', { engine, executable: executable || null })
}
export async function listAgentEngineModels(engine: ExternalAgentEngineId, executable?: string, workspace?: string) {
  return invoke<AgentEngineModel[]>('list_agent_engine_models', { engine, executable: executable || null, workspace: workspace || null })
}
export async function listAgentEngineCommands(engine: ExternalAgentEngineId, executable?: string, workspace?: string) {
  try {
    return await invoke<AgentEngineCommand[]>('list_agent_engine_commands', { engine, executable: executable || null, workspace: workspace || null })
  } catch {
    const fallback: Record<ExternalAgentEngineId, Array<[string, string]>> = {
      claude: [['context', '查看 Claude Code 上下文占用'], ['init', '初始化 CLAUDE.md'], ['review', '审查当前代码改动'], ['security-review', '执行安全审查'], ['usage', '查看 Claude Code 用量']],
      workbuddy: [['help', '查看 WorkBuddy 帮助'], ['doctor', '检查 WorkBuddy 环境'], ['status', '查看当前状态'], ['context', '查看上下文占用'], ['init', '初始化项目配置']],
      opencode: [['init', '初始化 OpenCode 项目配置'], ['undo', '撤销上一次修改'], ['redo', '重做上一次修改'], ['share', '分享当前会话'], ['help', '查看 OpenCode 帮助']],
      codex: [['status', '查看 Codex 状态'], ['review', '审查当前代码改动'], ['init', '初始化 AGENTS.md'], ['diff', '查看工作区差异'], ['compact', '压缩当前会话上下文']],
    }
    return fallback[engine].map(([name, description]) => ({ name, description, source: 'builtin' }))
  }
}
function textFromJson(value: unknown): string {
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const text = textFromJson(value[index])
      if (text) return text
    }
    return ''
  }
  if (!value || typeof value !== 'object') return ''

  const item = value as Record<string, unknown>
  if (typeof item.result === 'string') return item.result

  if (item.role === 'assistant') {
    if (typeof item.content === 'string') return item.content
    if (Array.isArray(item.content)) {
      const content = item.content
        .filter(part => part && typeof part === 'object')
        .map(part => {
          const block = part as Record<string, unknown>
          return block.type === 'output_text' && typeof block.text === 'string' ? block.text : ''
        })
        .filter(Boolean)
        .join('\n')
      if (content) return content
    }
  }

  if (typeof item.text === 'string') return item.text
  for (const key of ['item', 'part']) {
    const child = item[key]
    if (child && typeof child === 'object' && typeof (child as Record<string, unknown>).text === 'string') {
      return (child as Record<string, string>).text
    }
  }
  return ''
}
function modelFromJson(value: unknown): string {
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const model = modelFromJson(value[index])
      if (model) return model
    }
    return ''
  }
  if (!value || typeof value !== 'object') return ''
  const item = value as Record<string, unknown>
  const providerData = item.providerData
  if (providerData && typeof providerData === 'object' && typeof (providerData as Record<string, unknown>).model === 'string') {
    return (providerData as Record<string, string>).model
  }
  if (item.role === 'assistant' && typeof item.model === 'string') return item.model
  for (const key of ['message', 'item', 'part']) {
    const model = modelFromJson(item[key])
    if (model) return model
  }
  return ''
}
function parseAgentOutput(stdout: string): { content: string; model?: string } {
  const trimmed = stdout.trim(); if (!trimmed) return { content: '' }
  try {
    const parsed = JSON.parse(trimmed)
    const content = textFromJson(parsed)
    if (content) return { content, model: modelFromJson(parsed) || undefined }
  } catch { /* JSONL */ }
  const parsedLines = trimmed.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line) as unknown] } catch { return [] } })
  const chunks = parsedLines.map(textFromJson).filter(Boolean)
  return {
    content: chunks.length ? chunks[chunks.length - 1] : trimmed,
    model: modelFromJson(parsedLines) || undefined,
  }
}
export async function runExternalAgent(input: { runId: string; engine: ExternalAgentEngineId; prompt: string; workspace: string; executable?: string; model?: string; permissionMode: 'workspace-write' | 'read-only' }) {
  let result: { exitCode: number; stdout: string; stderr: string; cancelled: boolean }
  try {
    result = await invoke<typeof result>('run_agent_engine', { request: input })
  } catch (error) {
    const message = String(error)
    if (/command run_agent_engine not found/i.test(message)) {
      throw new Error('Agent 后端尚未加载。请完全退出并重新启动 NoteGoal 后再试。')
    }
    throw error
  }
  const parsed = parseAgentOutput(result.stdout)
  if (result.cancelled) return { ...parsed, stopped: true }
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `${input.engine} exited with code ${result.exitCode}`)
  if (!parsed.content) throw new Error(`${input.engine} 没有返回可显示的内容`)
  return { ...parsed, stopped: false }
}
export async function cancelExternalAgent(runId: string) { return invoke<boolean>('cancel_agent_engine', { runId }) }
