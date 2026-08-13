import { invoke } from '@tauri-apps/api/core'
import { Store } from '@tauri-apps/plugin-store'

export type AgentEngineId = 'native' | 'opencode' | 'claude' | 'codex' | 'workbuddy'
export type ExternalAgentEngineId = Exclude<AgentEngineId, 'native'>
export interface AgentEngineConfig { installed: boolean; executable?: string; permissionMode: 'workspace-write' | 'read-only' }
export interface AgentEngineSettings { selected: AgentEngineId; engines: Record<ExternalAgentEngineId, AgentEngineConfig> }
export interface AgentEngineInspection { engine: ExternalAgentEngineId; available: boolean; executable?: string; version?: string; error?: string }

const STORE_KEY = 'agentEngines.v1'
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

export function getAgentEngineName(engine: AgentEngineId) {
  if (engine === 'native') return 'NoteGoal 内置'
  return AGENT_ENGINE_CATALOG.find(item => item.id === engine)?.name || engine
}
export async function inspectAgentEngine(engine: ExternalAgentEngineId, executable?: string) {
  return invoke<AgentEngineInspection>('inspect_agent_engine', { engine, executable: executable || null })
}
function textFromJson(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const item = value as Record<string, unknown>
  if (typeof item.result === 'string') return item.result
  if (typeof item.text === 'string') return item.text
  for (const key of ['item', 'part']) {
    const child = item[key]
    if (child && typeof child === 'object' && typeof (child as Record<string, unknown>).text === 'string') return (child as Record<string, string>).text
  }
  return ''
}
function parseAgentOutput(stdout: string): string {
  const trimmed = stdout.trim(); if (!trimmed) return ''
  try { const text = textFromJson(JSON.parse(trimmed)); if (text) return text } catch { /* JSONL */ }
  const chunks = trimmed.split(/\r?\n/).map(line => { try { return textFromJson(JSON.parse(line)) } catch { return '' } }).filter(Boolean)
  return chunks.length ? chunks[chunks.length - 1] : trimmed
}
export async function runExternalAgent(input: { runId: string; engine: ExternalAgentEngineId; prompt: string; workspace: string; executable?: string; permissionMode: 'workspace-write' | 'read-only' }) {
  const result = await invoke<{ exitCode: number; stdout: string; stderr: string; cancelled: boolean }>('run_agent_engine', { request: input })
  const content = parseAgentOutput(result.stdout)
  if (result.cancelled) return { content, stopped: true }
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `${input.engine} exited with code ${result.exitCode}`)
  if (!content) throw new Error(`${input.engine} 没有返回可显示的内容`)
  return { content, stopped: false }
}
export async function cancelExternalAgent(runId: string) { return invoke<boolean>('cancel_agent_engine', { runId }) }
