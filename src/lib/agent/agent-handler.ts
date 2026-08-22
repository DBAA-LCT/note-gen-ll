import OpenAI from 'openai'
import useChatStore from '@/stores/chat'
import { skillManager } from '@/lib/skills'
import { BUILTIN_SKILL_CREATOR } from '@/lib/skills/creator'
import { useSkillsStore } from '@/stores/skills'
import { reloadMcpTools } from './tools'
import { AgentRuntime, isRequestAbortError } from './runtime'
import { readCurrentEditorState } from './tools/editor-tools'
import type { AgentApprovalDecision, AgentChange, AgentPermissionMode, AgentRuntimeResult, AgentSkillSummary, AgentState, AgentSteeringPayload, AgentStep, AgentTraceEvent, ToolCall } from './types'
import type { KernelEvent } from './kernel'
import type { RuntimeChatAttachment } from '@/lib/chat-attachments'
import type { AgentImageAttachment } from '@/lib/chat-image-context'
import { retainCompletedAgentTraceEvents } from './trace-retention'
import { appendHarnessEvent, harnessSessionId, type HarnessEventInput, type HarnessSessionEvent } from '@/lib/deepseek-harness/events'

export interface AgentHandlerConfig {
  /** Immutable UI run ownership token. */
  runToken: string
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
  onComplete?: (result: string, steps?: AgentStep[], stopped?: boolean) => void | Promise<void>
  onError?: (error: string) => void | Promise<void>
  onFinalAnswerRender?: (markdownContent: string) => void
  formatAutoFinalAnswer?: (key: string, values?: Record<string, string>) => string
  requestConfirmation?: (
    toolName: string,
    params: Record<string, any>,
    context?: {
      runId?: string
      toolCallId?: string
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
  initialHarnessEvents?: HarnessSessionEvent[]
}

export class AgentHandler {
  private runtime: AgentRuntime | null = null
  private stopped = false
  private readonly config: AgentHandlerConfig
  private steeringPending = false
  private pendingSteering: AgentSteeringPayload[] = []
  private readonly harnessSessionId: string
  private kernelEventsActive = false
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
    this.harnessSessionId = harnessSessionId(config.conversationId, config.activeChatId)
  }

  private isCurrentRun() {
    const state = useChatStore.getState()
    return state.agentState.clientRunToken === this.config.runToken
      && state.agentState.activeChatId === this.config.activeChatId
      && (this.config.conversationId === undefined
        ? state.isTemporaryConversation
        : state.currentConversationId === this.config.conversationId)
  }

  private setOwnedAgentState(state: Partial<AgentState>) {
    if (this.isCurrentRun()) useChatStore.getState().setAgentState(state)
  }

  private appendHarnessEvent<T>(event: Omit<HarnessEventInput<T>, 'sessionId'>) {
    if (!this.isCurrentRun()) return
    const store = useChatStore.getState()
    store.setAgentState({
      harnessEvents: appendHarnessEvent(store.agentState.harnessEvents || [], {
        ...event,
        sessionId: this.harnessSessionId,
      }),
    })
  }

  private appendKernelEvent(event: KernelEvent) {
    if (!this.isCurrentRun()) return
    const store = useChatStore.getState()
    store.setAgentState({ runId: event.runId })
    const common = { runId: event.runId, timestamp: event.timestamp }

    if (event.type === 'session/start') {
      if (!(store.agentState.harnessEvents || []).some(item => item.kind === 'session/start')) {
        this.appendHarnessEvent({ ...common, kind: 'session/start', data: event.data })
      }
      this.appendHarnessEvent({ ...common, kind: 'run/start', data: { runtime: 'notegoal-embedded', kernelSeq: event.seq } })
      return
    }
    if (event.type === 'session/end') {
      const data = event.data && typeof event.data === 'object'
        ? event.data as Record<string, unknown>
        : {}
      const kind = data.reason === 'stopped' || data.reason === 'cancelled'
        ? 'run/stopped'
        : data.reason === 'error' ? 'run/error' : 'run/end'
      this.appendHarnessEvent({ ...common, kind, data: { ...data, kernelSeq: event.seq } })
      return
    }
    if (event.type === 'turn/start') {
      this.appendHarnessEvent({ ...common, kind: 'turn/start', data: { ...this.asRecord(event.data), turn: event.turn, kernelSeq: event.seq } })
      return
    }
    if (event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'tool/call' || event.type === 'tool/result') {
      this.appendHarnessEvent({ ...common, kind: event.type, data: { ...this.asRecord(event.data), turn: event.turn, step: event.step, kernelSeq: event.seq } })
      return
    }
    if (event.type === 'step/end') {
      this.appendHarnessEvent({ ...common, kind: 'step/complete', data: { ...this.asRecord(event.data), turn: event.turn, step: event.step, kernelSeq: event.seq } })
      return
    }
    this.appendHarnessEvent({
      ...common,
      kind: 'trace/event',
      data: { ...this.asRecord(event.data), upstreamType: event.type, turn: event.turn, step: event.step, kernelSeq: event.seq },
    })
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
  }

  async execute(
    userInput: string,
    contextOrMessages?: string | OpenAI.Chat.ChatCompletionMessageParam[],
    imageUrls?: string[]
  ): Promise<string> {
    return this.executeEmbedded(userInput, contextOrMessages, imageUrls)
  }

  /** Run NoteGoal's in-process runtime with the embedded DSH-style kernel. */
  private async executeEmbedded(
    userInput: string,
    contextOrMessages?: string | OpenAI.Chat.ChatCompletionMessageParam[],
    imageUrls?: string[],
  ): Promise<string> {
    const store = useChatStore.getState()
    this.stopped = false
    this.kernelEventsActive = true
    this.retrievedKnowledgeSources.clear()

    if (!this.isCurrentRun()) return ''
    store.resetAgentState()
    store.setAgentState({
      clientRunToken: this.config.runToken,
      activeChatId: this.config.activeChatId,
      isRunning: true,
      isThinking: false,
      status: 'preparing_context',
      selectedSkills: this.config.selectedSkills,
      currentStepStartTime: Date.now(),
      harnessEvents: this.config.initialHarnessEvents || [],
    })

    this.runtime = new AgentRuntime()
    if (this.steeringPending) {
      this.runtime.beginSteering()
    }
    for (const payload of this.pendingSteering.splice(0)) {
      this.runtime.steer(payload)
    }

    try {
    await this.initializeMcp()
    const { useMcpStore } = await import('@/stores/mcp')
    const selectedMcpServerIds = [...useMcpStore.getState().selectedServerIds]
    const skillsInfo = await this.getSkillsInfo()
    const currentEditorState = this.config.activeFilePath
      ? await readCurrentEditorState().catch(() => undefined)
      : undefined

    if (!this.isCurrentRun()) return ''
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
        onKernelEvent: (event) => {
          this.appendKernelEvent(event)
        },
        onStatus: (status) => {
          if (!this.isCurrentRun()) return
          this.appendHarnessEvent({
            kind: 'run/status',
            runId: useChatStore.getState().agentState.runId,
            data: { status },
          })
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
          if (!this.isCurrentRun()) return
          store.setAgentState({
            activeChatId: this.config.activeChatId,
            isFinalAnswerMode: true,
            finalAnswerContent: content,
          })
        },
        onCandidateAnswerClear: () => {
          if (!this.isCurrentRun()) return
          store.setAgentState({
            isFinalAnswerMode: false,
            finalAnswerContent: undefined,
          })
        },
        onFinalAnswerRender: (content) => {
          if (!this.isCurrentRun()) return
          store.setAgentState({
            activeChatId: this.config.activeChatId,
            isFinalAnswerMode: true,
            finalAnswerContent: content,
          })
          this.config.onFinalAnswerRender?.(content)
        },
        requestConfirmation: async (toolName, params, context) => {
          if (!this.isCurrentRun()) return 'denied'
          return await this.config.requestConfirmation?.(toolName, params, context) || 'denied'
        },
      })

      this.finishRun(result)
      if (this.isCurrentRun()) await this.config.onComplete?.(result.content, result.steps, result.stopped)
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
        await this.config.onComplete?.(partialContent, agentState.completedSteps, true)
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
    } finally {
      this.kernelEventsActive = false
      this.runtime = null
      this.steeringPending = false
    }
  }

  stop() {
    if (!this.isCurrentRun()) return
    this.stopped = true
    const state = useChatStore.getState()
    const pending = state.agentState.pendingConfirmation
    if (pending && pending.runToken === this.config.runToken) {
      state.setAgentState({
        pendingConfirmation: undefined,
        confirmationHistory: [
          ...state.agentState.confirmationHistory,
          {
            approvalId: pending.approvalId,
            runToken: pending.runToken,
            conversationId: pending.conversationId,
            runId: pending.runId,
            toolCallId: pending.toolCallId,
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
    if (!this.isCurrentRun()) return
    const state = useChatStore.getState()
    const pending = state.agentState.pendingConfirmation
    if (pending && pending.runToken === this.config.runToken) {
      state.setAgentState({
        pendingConfirmation: undefined,
        confirmationHistory: [
          ...state.agentState.confirmationHistory,
          {
            approvalId: pending.approvalId,
            runToken: pending.runToken,
            conversationId: pending.conversationId,
            runId: pending.runId,
            toolCallId: pending.toolCallId,
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
    if (!this.isCurrentRun()) return
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
    this.appendHarnessEvent({
      kind: 'trace/event',
      runId: event.runId,
      timestamp: event.timestamp,
      data: event,
    })
  }

  private upsertToolCall(toolCall: ToolCall) {
    if (!this.isCurrentRun()) return
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
    if (!this.kernelEventsActive) {
      this.appendHarnessEvent({
        kind: toolCall.status === 'success' || toolCall.status === 'error' ? 'tool/result' : 'tool/call',
        runId: currentState.agentState.runId,
        timestamp: toolCall.timestamp,
        data: toolCall,
      })
    }

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
    if (!this.isCurrentRun()) return
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
      ragSources: ragSourceDetails.map(detail => detail.sourceKey || detail.filename),
      ragSourceDetails,
    })
  }

  private appendLoadedSkill(skillId: unknown) {
    if (!this.isCurrentRun()) return
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
    if (!this.isCurrentRun()) return
    const current = useChatStore.getState().agentState
    useChatStore.getState().setAgentState({
      completedSteps: [...current.completedSteps, step],
      currentObservation: step.observation,
      currentThought: step.thought,
    })
    if (!this.kernelEventsActive) {
      this.appendHarnessEvent({
        kind: 'step/complete',
        runId: current.runId,
        data: step,
      })
    }
  }

  private appendChange(change: AgentChange) {
    if (!this.isCurrentRun()) return
    const current = useChatStore.getState().agentState
    useChatStore.getState().setAgentState({
      changes: [
        ...(current.changes || []).filter((item) => item.id !== change.id),
        change,
      ],
    })
  }

  private finishRun(result: AgentRuntimeResult) {
    if (!this.isCurrentRun()) return
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
