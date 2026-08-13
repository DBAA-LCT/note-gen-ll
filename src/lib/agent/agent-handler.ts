import OpenAI from 'openai'
import useChatStore from '@/stores/chat'
import { skillManager } from '@/lib/skills'
import { BUILTIN_SKILL_CREATOR } from '@/lib/skills/creator'
import { useSkillsStore } from '@/stores/skills'
import { getToolsByCategory, reloadMcpTools } from './tools'
import { AgentRuntime, isRequestAbortError } from './runtime'
import { readCurrentEditorState } from './tools/editor-tools'
import type { AgentApprovalDecision, AgentChange, AgentPermissionMode, AgentRuntimeResult, AgentSkillSummary, AgentSteeringPayload, AgentStep, AgentToolResult, AgentTraceEvent, ToolCall } from './types'
import type { RuntimeChatAttachment } from '@/lib/chat-attachments'
import type { AgentImageAttachment } from '@/lib/chat-image-context'
import { retainCompletedAgentTraceEvents } from './trace-retention'
import { cancelExternalAgent, loadAgentEngineSettings, runExternalAgent, saveAgentEngineSettings } from '@/lib/agent-engines'

const EXTERNAL_HOST_TOOL_PATTERN = /<notegoal-tool-call>\s*([\s\S]*?)\s*<\/notegoal-tool-call>/i
const EXTERNAL_TOOL_UNAVAILABLE_PATTERN = /(?:learning_[a-z_]+|NoteGoal[\s\S]{0,40}(?:工具|tools?))[\s\S]{0,240}(?:不在[\s\S]{0,30}(?:工具集|tools?)|无法(?:真正)?调用|不可用|unavailable|not available|cannot call)/i
const LEARNING_WORKFLOW_PATTERN = /learning_|学习(?:目标|计划|规划|日报|访谈|任务|日程)|长期目标|今日计划|每日计划|整日回顾/i
const TERMINAL_LEARNING_TOOLS = new Set([
  'learning_ask_interview_question',
  'learning_propose_goal',
  'learning_propose_daily_plan',
  'learning_propose_daily_report',
])

function parseExternalHostToolCall(content: string): { name: string; arguments: Record<string, unknown> } | null {
  const match = content.match(EXTERNAL_HOST_TOOL_PATTERN)
  if (!match) return null
  try {
    const value = JSON.parse(match[1]) as { name?: unknown; arguments?: unknown }
    if (typeof value.name !== 'string' || !value.name.trim()) return null
    const args = value.arguments && typeof value.arguments === 'object' && !Array.isArray(value.arguments)
      ? value.arguments as Record<string, unknown>
      : {}
    return { name: value.name.trim(), arguments: args }
  } catch {
    return null
  }
}

function buildExternalHostToolInstructions() {
  const tools = getToolsByCategory('system').filter(tool => tool.name.startsWith('learning_'))
  if (!tools.length) return { instructions: '', tools }
  const catalog = tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))
  return {
    tools,
    instructions: [
      '## NoteGoal host tools (real and currently available)',
      'The following tools are provided by the NoteGoal host application. They are not CLI, MCP, ToolSearch, or plugin tools. Never search for them with ToolSearch and never say they are unavailable.',
      'To call one tool, your entire response for that turn must be exactly one XML envelope containing valid JSON:',
      '<notegoal-tool-call>{"name":"tool_name","arguments":{}}</notegoal-tool-call>',
      'Call only one host tool at a time. NoteGoal will execute it locally and return the result, after which you may call another tool or answer normally.',
      'For learning interviews, every question must use learning_ask_interview_question. For draft cards, call the matching learning_propose_* tool instead of substituting ordinary text.',
      JSON.stringify(catalog),
    ].join('\n'),
  }
}

function hiddenExternalToolContext(name: string, args: Record<string, unknown>, result: unknown) {
  return `<!-- notegoal-host-tool-context:${encodeURIComponent(JSON.stringify({ name, arguments: args, result }))} -->`
}

export interface AgentHandlerConfig {
  activeChatId?: number
  activeFilePath?: string
  activeCanvasId?: string
  permissionMode?: AgentPermissionMode
  conversationId?: number
  workspaceId?: string
  useMemories?: boolean
  onThought?: (thought: string) => void
  onAction?: (action: string, params: Record<string, any>) => void
  onObservation?: (observation: string) => void
  onComplete?: (result: string, steps?: AgentStep[], stopped?: boolean) => void
  onError?: (error: string) => void
  onFinalAnswerRender?: (markdownContent: string) => void
  formatAutoFinalAnswer?: (key: string, values?: Record<string, string>) => string
  requestConfirmation?: (
    toolName: string,
    params: Record<string, any>,
    context?: {
      previewParams?: Record<string, any>
      originalContent?: string
      modifiedContent?: string
      filePath?: string
      from?: number
      to?: number
    }
  ) => Promise<AgentApprovalDecision>
  currentQuote?: {
    fileName: string
    startLine: number
    endLine: number
    from: number
    to: number
    fullContent?: string
  }
  attachments?: RuntimeChatAttachment[]
  imageAttachments?: AgentImageAttachment[]
  selectedSkills?: string[]
}

export class AgentHandler {
  private runtime: AgentRuntime | null = null
  private externalRunId: string | null = null
  private stopped = false
  private readonly config: AgentHandlerConfig
  private steeringPending = false
  private pendingSteering: AgentSteeringPayload[] = []
  private retrievedKnowledgeSources = new Map<string, {
    filepath: string
    filename: string
    content: string
    sourceKey: string
    sourceType: 'article' | 'record' | 'canvas'
    sourceId: string
    locator?: {
      filePath?: string
      markId?: number
      tagId?: number
      canvasId?: string
      nodeIds?: string[]
    }
    updatedAt?: number
  }>()

  constructor(config: AgentHandlerConfig) {
    this.config = config
  }

  async execute(
    userInput: string,
    contextOrMessages?: string | OpenAI.Chat.ChatCompletionMessageParam[],
    imageUrls?: string[]
  ): Promise<string> {
    const store = useChatStore.getState()
    this.retrievedKnowledgeSources.clear()

    store.resetAgentState()
    store.setAgentState({
      activeChatId: this.config.activeChatId,
      isRunning: true,
      isThinking: false,
      status: 'preparing_context',
      selectedSkills: this.config.selectedSkills,
      currentStepStartTime: Date.now(),
    })

    const engineSettings = await loadAgentEngineSettings()
    if (engineSettings.selected !== 'native') {
      const engine = engineSettings.selected
      const engineConfig = engineSettings.engines[engine]
      if (engineConfig.installed) {
        this.externalRunId = crypto.randomUUID()
        store.setAgentState({ status: 'thinking', isRunning: true, isThinking: true })
        const history = Array.isArray(contextOrMessages)
          ? contextOrMessages.map(message => `${message.role}: ${typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}`).join('\n\n')
          : contextOrMessages || ''
        const prompt = history ? `${history}\n\nuser: ${userInput}` : userInput
        try {
          const hostBridge = LEARNING_WORKFLOW_PATTERN.test(prompt)
            ? buildExternalHostToolInstructions()
            : { instructions: '', tools: [] }
          const hostTools = new Map(hostBridge.tools.map(tool => [tool.name, tool]))
          let turnPrompt = hostBridge.instructions
            ? `${prompt}\n\n${hostBridge.instructions}`
            : prompt
          let result: Awaited<ReturnType<typeof runExternalAgent>> | undefined
          let finalContent = ''

          for (let iteration = 0; iteration < 8; iteration += 1) {
            if (this.stopped) break
            result = await runExternalAgent({
              runId: this.externalRunId,
              engine,
              prompt: turnPrompt,
              workspace: engineConfig.workspace?.trim() || this.config.workspaceId || '.',
              executable: engineConfig.executable,
              model: engineConfig.model,
              permissionMode: engineConfig.permissionMode,
            })
            if (result.stopped) {
              finalContent = result.content
              break
            }

            const requestedCall = parseExternalHostToolCall(result.content)
            if (!requestedCall) {
              if (hostBridge.instructions && iteration === 0 && EXTERNAL_TOOL_UNAVAILABLE_PATTERN.test(result.content)) {
                turnPrompt += [
                  '',
                  `assistant: ${result.content}`,
                  'NoteGoal host: Your previous statement was incorrect. These host tools are available through the XML bridge described above; they intentionally do not appear in your CLI ToolSearch. Make the required host tool call now.',
                ].join('\n\n')
                continue
              }
              finalContent = result.content
              break
            }

            const tool = hostTools.get(requestedCall.name)
            if (!tool) {
              turnPrompt += [
                '',
                `assistant: ${result.content}`,
                `NoteGoal host: Tool ${requestedCall.name} is not exposed in this workflow. Use one of: ${[...hostTools.keys()].join(', ')}.`,
              ].join('\n\n')
              continue
            }

            const toolCall: ToolCall = {
              id: `external-${crypto.randomUUID()}`,
              toolName: tool.name,
              params: requestedCall.arguments,
              status: 'running',
              timestamp: Date.now(),
            }
            store.addAgentToolCall(toolCall)
            store.setAgentState({ status: 'calling_tool', isThinking: false, currentAction: tool.title })

            let toolResult: AgentToolResult
            try {
              if (tool.risk !== 'read' && engineConfig.permissionMode === 'read-only') {
                toolResult = { ok: false, message: '当前外部 Agent 是只读模式，已阻止写入类 NoteGoal 工具。', error: 'READ_ONLY_MODE' }
              } else if (tool.risk !== 'read') {
                const decision = await this.config.requestConfirmation?.(tool.name, requestedCall.arguments)
                toolResult = decision === 'approved'
                  ? await tool.execute(requestedCall.arguments, {
                      runId: this.externalRunId,
                      context: {
                        activeChatId: this.config.activeChatId,
                        activeFilePath: this.config.activeFilePath,
                        activeCanvasId: this.config.activeCanvasId,
                        userInput,
                        currentQuote: this.config.currentQuote,
                        selectedSkills: this.config.selectedSkills,
                        attachments: this.config.attachments,
                        imageAttachments: this.config.imageAttachments,
                      },
                    })
                  : { ok: false, message: '用户未批准此 NoteGoal 工具调用。', error: 'USER_DENIED' }
              } else {
                toolResult = await tool.execute(requestedCall.arguments, {
                  runId: this.externalRunId,
                  context: {
                    activeChatId: this.config.activeChatId,
                    activeFilePath: this.config.activeFilePath,
                    activeCanvasId: this.config.activeCanvasId,
                    userInput,
                    currentQuote: this.config.currentQuote,
                    selectedSkills: this.config.selectedSkills,
                    attachments: this.config.attachments,
                    imageAttachments: this.config.imageAttachments,
                  },
                })
              }
            } catch (error) {
              toolResult = {
                ok: false,
                message: error instanceof Error ? error.message : String(error),
                error: 'HOST_TOOL_EXECUTION_FAILED',
              }
            }
            store.updateAgentToolCall(toolCall.id, {
              status: toolResult.ok ? 'success' : 'error',
              result: {
                success: toolResult.ok,
                message: toolResult.message,
                data: toolResult.data,
                error: toolResult.error,
                changes: toolResult.changes,
              },
            })

            if (toolResult.ok && TERMINAL_LEARNING_TOOLS.has(tool.name)) {
              finalContent = `${toolResult.message}\n\n${hiddenExternalToolContext(tool.name, requestedCall.arguments, toolResult)}`
              break
            }

            turnPrompt += [
              '',
              `assistant: ${result.content}`,
              `NoteGoal host tool result for ${tool.name}: ${JSON.stringify(toolResult)}`,
              'Continue the task. Call another NoteGoal host tool with the XML envelope when needed, or answer normally when finished.',
            ].join('\n\n')
            store.setAgentState({ status: 'thinking', isThinking: true, currentAction: undefined })
          }

          if (!result) {
            finalContent = ''
            result = { content: '', stopped: this.stopped }
          }
          if (!finalContent && !this.stopped) {
            throw new Error(`${engine} exceeded the NoteGoal host tool call limit`)
          }

          if (result.model && result.model !== engineConfig.lastUsedModel) {
            const nextSettings = {
              ...engineSettings,
              engines: {
                ...engineSettings.engines,
                [engine]: { ...engineConfig, lastUsedModel: result.model },
              },
            }
            await saveAgentEngineSettings(nextSettings).catch(error => {
              console.warn('[Agent Handler] Failed to save the actual external model:', error)
            })
          }
          store.setAgentState({
            isRunning: false,
            isThinking: false,
            status: result.stopped ? 'stopped' : 'completed',
            isFinalAnswerMode: true,
            finalAnswerContent: finalContent,
          })
          this.config.onFinalAnswerRender?.(finalContent)
          this.config.onComplete?.(finalContent, [], result.stopped)
          return finalContent
        } catch (error) {
          store.setAgentState({ isRunning: false, isThinking: false, status: this.stopped ? 'stopped' : 'failed' })
          const message = error instanceof Error ? error.message : String(error)
          if (this.stopped) {
            this.config.onComplete?.('', [], true)
            return ''
          }
          await this.config.onError?.(message)
          throw error
        } finally {
          this.externalRunId = null
        }
      }
    }

    this.runtime = new AgentRuntime()
    if (this.steeringPending) {
      this.runtime.beginSteering()
    }
    for (const payload of this.pendingSteering.splice(0)) {
      this.runtime.steer(payload)
    }

    await this.initializeMcp()
    const { useMcpStore } = await import('@/stores/mcp')
    const selectedMcpServerIds = [...useMcpStore.getState().selectedServerIds]
    const skillsInfo = await this.getSkillsInfo()
    const currentEditorState = this.config.activeFilePath
      ? await readCurrentEditorState().catch(() => undefined)
      : undefined

    if (this.stopped) {
      store.setAgentState({
        isRunning: false,
        isThinking: false,
        status: 'stopped',
      })
      this.config.onComplete?.('', [], true)
      return ''
    }

    const messages = Array.isArray(contextOrMessages)
      ? contextOrMessages
      : contextOrMessages
        ? [{ role: 'system' as const, content: contextOrMessages }]
        : []

    try {
      const result = await this.runtime.run({
        userInput,
        messages,
        imageUrls,
        activeChatId: this.config.activeChatId,
        activeFilePath: this.config.activeFilePath,
        activeCanvasId: this.config.activeCanvasId,
        currentEditorState,
        currentQuote: this.config.currentQuote,
        availableSkills: skillsInfo,
        selectedSkills: this.config.selectedSkills,
        selectedMcpServerIds,
        attachments: this.config.attachments,
        imageAttachments: this.config.imageAttachments,
        permissionMode: this.config.permissionMode,
        conversationId: this.config.conversationId,
        workspaceId: this.config.workspaceId,
        useMemories: this.config.useMemories,
      }, {
        onStatus: (status) => {
          store.setAgentState({
            status,
            isRunning: status !== 'completed' && status !== 'failed' && status !== 'stopped',
            isThinking: status === 'thinking',
            currentStepStartTime: status === 'thinking' || status === 'calling_tool'
              ? Date.now()
              : useChatStore.getState().agentState.currentStepStartTime,
          })
        },
        onTrace: (event) => {
          this.appendTrace(event)
        },
        onToolCall: (toolCall) => {
          this.upsertToolCall(toolCall)
        },
        onChange: (change) => {
          this.appendChange(change)
        },
        onStep: (step) => {
          this.appendStep(step)
          if (step.action) {
            this.config.onAction?.(step.action.tool, step.action.params)
          }
          if (step.observation) {
            this.config.onObservation?.(step.observation)
          }
        },
        onCandidateAnswerRender: (content) => {
          store.setAgentState({
            activeChatId: this.config.activeChatId,
            isFinalAnswerMode: true,
            finalAnswerContent: content,
          })
        },
        onCandidateAnswerClear: () => {
          store.setAgentState({
            isFinalAnswerMode: false,
            finalAnswerContent: undefined,
          })
        },
        onFinalAnswerRender: (content) => {
          store.setAgentState({
            activeChatId: this.config.activeChatId,
            isFinalAnswerMode: true,
            finalAnswerContent: content,
          })
          this.config.onFinalAnswerRender?.(content)
        },
        requestConfirmation: async (toolName, params, context) => {
          return await this.config.requestConfirmation?.(toolName, params, context) || 'denied'
        },
      })

      this.finishRun(result)
      this.config.onComplete?.(result.content, result.steps, result.stopped)
      return result.content
    } catch (error) {
      if (this.stopped || isRequestAbortError(error)) {
        const agentState = useChatStore.getState().agentState
        const latestModelOutput = [...(agentState.traceEvents || [])]
          .reverse()
          .find(event => (
            event.type === 'model_response' || event.type === 'model_call'
          ) && typeof event.output === 'string')
          ?.output
        const partialContent = agentState.finalAnswerContent
          || (typeof latestModelOutput === 'string' ? latestModelOutput : '')
        store.setAgentState({
          isRunning: false,
          isThinking: false,
          status: 'stopped',
        })
        this.config.onComplete?.(partialContent, agentState.completedSteps, true)
        return partialContent
      }

      store.setAgentState({
        isRunning: false,
        isThinking: false,
        status: 'failed',
      })
      const errorMessage = error instanceof Error ? error.message : String(error)
      await this.config.onError?.(errorMessage)
      throw error
    }
  }

  stop() {
    this.stopped = true
    if (this.externalRunId) void cancelExternalAgent(this.externalRunId)
    const state = useChatStore.getState()
    const pending = state.agentState.pendingConfirmation
    if (pending) {
      state.setAgentState({
        pendingConfirmation: undefined,
        confirmationHistory: [
          ...state.agentState.confirmationHistory,
          {
            toolName: pending.toolName,
            params: pending.params,
            status: 'cancelled',
            timestamp: Date.now(),
          },
        ],
      })
    }
    this.runtime?.stop()
  }

  beginSteering() {
    const state = useChatStore.getState()
    const pending = state.agentState.pendingConfirmation
    if (pending) {
      state.setAgentState({
        pendingConfirmation: undefined,
        confirmationHistory: [
          ...state.agentState.confirmationHistory,
          {
            toolName: pending.toolName,
            params: pending.params,
            status: 'superseded',
            timestamp: Date.now(),
          },
        ],
        status: 'steering',
        isRunning: true,
      })
    }
    this.steeringPending = true
    this.runtime?.beginSteering()
  }

  steer(payload: AgentSteeringPayload) {
    this.steeringPending = true
    if (this.runtime) {
      this.runtime.steer(payload)
    } else {
      this.pendingSteering.push(payload)
    }
  }

  private async initializeMcp() {
    try {
      const { useMcpStore } = await import('@/stores/mcp')
      const mcpStore = useMcpStore.getState()
      if (!mcpStore.initialized) {
        await mcpStore.initMcpData()
      }
      await reloadMcpTools()
    } catch (error) {
      console.error('[Agent Handler] Failed to initialize MCP:', error)
    }
  }

  private async getSkillsInfo(): Promise<AgentSkillSummary[]> {
    const skillsStore = useSkillsStore.getState()

    if (!skillsStore.enabled) {
      return []
    }

    const creator = {
      id: BUILTIN_SKILL_CREATOR.id,
      name: BUILTIN_SKILL_CREATOR.name,
      description: BUILTIN_SKILL_CREATOR.description,
    }

    try {
      await skillsStore.initSkills()
      const enabledSkills = await skillManager.getEnabledSkills()
      const selectedSkillIds = new Set(this.config.selectedSkills || [])
      const visibleSkills = skillsStore.autoMatch
        ? enabledSkills
        : enabledSkills.filter(skill => selectedSkillIds.has(skill.metadata.id))

      return [creator, ...visibleSkills
        .filter((skill) => skill.metadata.id !== BUILTIN_SKILL_CREATOR.id)
        .map((skill) => ({
          id: skill.metadata.id,
          name: skill.metadata.name,
          description: skill.metadata.description,
          scope: skill.metadata.scope,
        }))]
    } catch (error) {
      console.error('[Agent Handler] Failed to load skills:', error)
      return [creator]
    }
  }

  private appendTrace(event: AgentTraceEvent) {
    const current = useChatStore.getState().agentState
    useChatStore.getState().setAgentState({
      runId: event.runId,
      traceEvents: [
        ...(current.traceEvents || []).filter((item) => item.id !== event.id),
        event,
      ],
      currentThought: event.message || event.title,
    })
    this.config.onThought?.(event.message || event.title)
  }

  private upsertToolCall(toolCall: ToolCall) {
    const currentState = useChatStore.getState()
    const existing = currentState.agentState.toolCalls.find((item) => item.id === toolCall.id)
    if (existing) {
      currentState.updateAgentToolCall(toolCall.id, toolCall)
    } else {
      currentState.addAgentToolCall(toolCall)
    }

    currentState.setAgentState({
      currentAction: `${toolCall.toolName}(${JSON.stringify(toolCall.params)})`,
    })

    if (toolCall.toolName === 'skill_load' && toolCall.status === 'success') {
      this.appendLoadedSkill(toolCall.params.skill_id)
    }

    if (toolCall.toolName === 'knowledge_search' && toolCall.status === 'success') {
      this.captureKnowledgeSearchCandidates(toolCall)
    }
    if (toolCall.toolName === 'knowledge_read_sources' && toolCall.status === 'success') {
      this.captureKnowledgeReadPages(toolCall)
    }
    if (toolCall.toolName === 'knowledge_cite_sources' && toolCall.status === 'success') {
      this.captureCitedKnowledgeSources(toolCall)
    }
  }

  private captureKnowledgeSearchCandidates(toolCall: ToolCall) {
    const data = toolCall.result?.data
    if (!Array.isArray(data)) return
    for (const value of data) {
      if (!value || typeof value !== 'object') continue
      const candidate = value as {
        sourceKey?: unknown
        sourceType?: unknown
        sourceId?: unknown
        title?: unknown
        fragments?: unknown
        locator?: unknown
        updatedAt?: unknown
      }
      if (
        typeof candidate.sourceKey !== 'string'
        || (candidate.sourceType !== 'article' && candidate.sourceType !== 'record' && candidate.sourceType !== 'canvas')
      ) continue
      const locator = candidate.locator && typeof candidate.locator === 'object'
        ? candidate.locator as {
            filePath?: string
            markId?: number
            tagId?: number
            canvasId?: string
            nodeIds?: string[]
          }
        : undefined
      const fragments = Array.isArray(candidate.fragments)
        ? candidate.fragments.flatMap(fragment => (
            fragment && typeof fragment === 'object' && typeof (fragment as { content?: unknown }).content === 'string'
              ? [(fragment as { content: string }).content]
              : []
          ))
        : []
      const title = typeof candidate.title === 'string' ? candidate.title : candidate.sourceKey
      this.retrievedKnowledgeSources.set(candidate.sourceKey, {
        sourceKey: candidate.sourceKey,
        sourceType: candidate.sourceType,
        sourceId: typeof candidate.sourceId === 'string' ? candidate.sourceId : candidate.sourceKey,
        filepath: locator?.filePath || candidate.sourceKey,
        filename: title,
        content: fragments.join('\n\n'),
        locator,
        updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : undefined,
      })
    }
  }

  private captureKnowledgeReadPages(toolCall: ToolCall) {
    const data = toolCall.result?.data
    if (!Array.isArray(data)) return
    for (const value of data) {
      if (!value || typeof value !== 'object') continue
      const page = value as { sourceKey?: unknown; content?: unknown }
      if (typeof page.sourceKey !== 'string' || typeof page.content !== 'string') continue
      const current = this.retrievedKnowledgeSources.get(page.sourceKey)
      if (!current) continue
      this.retrievedKnowledgeSources.set(page.sourceKey, {
        ...current,
        content: current.content.includes(page.content)
          ? current.content
          : [current.content, page.content].filter(Boolean).join('\n\n'),
      })
    }
  }

  private captureCitedKnowledgeSources(toolCall: ToolCall) {
    const data = toolCall.result?.data
    if (!data || typeof data !== 'object') return
    const sourceKeys = (data as { sourceKeys?: unknown }).sourceKeys
    if (!Array.isArray(sourceKeys)) return
    const ragSourceDetails = sourceKeys.flatMap(sourceKey => (
      typeof sourceKey === 'string' && this.retrievedKnowledgeSources.has(sourceKey)
        ? [this.retrievedKnowledgeSources.get(sourceKey)!]
        : []
    ))
    useChatStore.getState().setAgentState({
      ragSources: ragSourceDetails.map(detail => detail.filename),
      ragSourceDetails,
    })
  }

  private appendLoadedSkill(skillId: unknown) {
    if (typeof skillId !== 'string' || !skillId) {
      return
    }

    const skill = skillManager.getSkill(skillId)
    const builtIn = skillId === BUILTIN_SKILL_CREATOR.id ? BUILTIN_SKILL_CREATOR : undefined
    const current = useChatStore.getState().agentState.loadedSkills || []
    if (current.some((item) => item.id === skillId)) {
      return
    }

    useChatStore.getState().setAgentState({
      loadedSkills: [
        ...current,
        {
          id: skillId,
          name: skill?.metadata.name || builtIn?.name || skillId,
          description: skill?.metadata.description || builtIn?.description,
        },
      ],
    })
  }

  private appendStep(step: AgentStep) {
    const current = useChatStore.getState().agentState
    useChatStore.getState().setAgentState({
      completedSteps: [...current.completedSteps, step],
      currentObservation: step.observation,
      currentThought: step.thought,
    })
  }

  private appendChange(change: AgentChange) {
    const current = useChatStore.getState().agentState
    useChatStore.getState().setAgentState({
      changes: [
        ...(current.changes || []).filter((item) => item.id !== change.id),
        change,
      ],
    })
  }

  private finishRun(result: AgentRuntimeResult) {
    const store = useChatStore.getState()
    store.setAgentState({
      runId: result.runId,
      isRunning: false,
      isThinking: false,
      status: result.stopped ? 'stopped' : 'completed',
      completedSteps: result.steps,
      toolCalls: result.toolCalls,
      changes: result.changes,
      traceEvents: retainCompletedAgentTraceEvents(result.trace),
      currentAction: undefined,
      currentObservation: undefined,
    })
  }
}
