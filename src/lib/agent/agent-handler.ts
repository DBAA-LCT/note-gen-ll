import OpenAI from 'openai'
import useChatStore from '@/stores/chat'
import { skillManager } from '@/lib/skills'
import { BUILTIN_SKILL_CREATOR } from '@/lib/skills/creator'
import { useSkillsStore } from '@/stores/skills'
import { reloadMcpTools } from './tools'
import { AgentRuntime, isRequestAbortError } from './runtime'
import { readCurrentEditorState } from './tools/editor-tools'
import type { AgentApprovalDecision, AgentChange, AgentPermissionMode, AgentRuntimeResult, AgentSkillSummary, AgentSteeringPayload, AgentStep, AgentTraceEvent, ToolCall } from './types'
import type { RuntimeChatAttachment } from '@/lib/chat-attachments'
import type { AgentImageAttachment } from '@/lib/chat-image-context'
import { retainCompletedAgentTraceEvents } from './trace-retention'

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
