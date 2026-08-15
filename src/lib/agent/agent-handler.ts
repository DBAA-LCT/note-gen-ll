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
import { appendHarnessEvent, harnessSessionId, type HarnessEventInput, type HarnessSessionEvent } from '@/lib/deepseek-harness/events'
import { deepSeekHarnessClient, type HarnessWireEvent, type HarnessWireNotification } from '@/lib/deepseek-harness/client'
import { getAISettings } from '@/lib/ai/utils'
import { cancelHarnessQuestions, requestHarnessQuestions, type HarnessQuestion } from '@/lib/deepseek-harness/interaction'
import { getDefaultArticleAbsolutePath, getWorkspacePath } from '@/lib/workspace'

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
  initialHarnessEvents?: HarnessSessionEvent[]
}

export class AgentHandler {
  private runtime: AgentRuntime | null = null
  private stopped = false
  private readonly config: AgentHandlerConfig
  private steeringPending = false
  private pendingSteering: AgentSteeringPayload[] = []
  private readonly harnessSessionId: string
  private harnessActive = false
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

  private appendHarnessEvent<T>(event: Omit<HarnessEventInput<T>, 'sessionId'>) {
    const store = useChatStore.getState()
    store.setAgentState({
      harnessEvents: appendHarnessEvent(store.agentState.harnessEvents || [], {
        ...event,
        sessionId: this.harnessSessionId,
      }),
    })
  }

  async execute(
    userInput: string,
    contextOrMessages?: string | OpenAI.Chat.ChatCompletionMessageParam[],
    imageUrls?: string[]
  ): Promise<string> {
    void imageUrls
    return this.executeHarness(userInput, contextOrMessages)
  }

  /** Retained only while old persisted trace records are upgraded to Harness events. */
  private async executeLegacy(
    userInput: string,
    contextOrMessages?: string | OpenAI.Chat.ChatCompletionMessageParam[],
    imageUrls?: string[],
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
      harnessEvents: this.config.initialHarnessEvents || [],
    })
    if (!this.config.initialHarnessEvents?.length) {
      this.appendHarnessEvent({ kind: 'session/start', data: { conversationId: this.config.conversationId } })
    }
    this.appendHarnessEvent({ kind: 'turn/start', data: { activeChatId: this.config.activeChatId } })
    this.appendHarnessEvent({ kind: 'user/message', data: { content: userInput, imageUrls: imageUrls || [] } })
    this.appendHarnessEvent({ kind: 'run/start', data: { activeFilePath: this.config.activeFilePath } })

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
      this.appendHarnessEvent({
        kind: 'assistant/message',
        runId: result.runId,
        data: { content: result.content },
      })
      this.appendHarnessEvent({
        kind: result.stopped ? 'run/stopped' : 'run/end',
        runId: result.runId,
        data: { stopped: result.stopped, steps: result.steps.length, toolCalls: result.toolCalls.length },
      })
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
        this.appendHarnessEvent({ kind: 'run/stopped', data: { content: partialContent } })
        this.config.onComplete?.(partialContent, agentState.completedSteps, true)
        return partialContent
      }

      store.setAgentState({
        isRunning: false,
        isThinking: false,
        status: 'failed',
      })
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.appendHarnessEvent({ kind: 'run/error', data: { message: errorMessage } })
      await this.config.onError?.(errorMessage)
      throw error
    }
  }

  private async executeHarness(
    userInput: string,
    contextOrMessages?: string | OpenAI.Chat.ChatCompletionMessageParam[],
  ): Promise<string> {
    const store = useChatStore.getState()
    const runId = `harness-${Date.now()}`
    let streamedContent = ''
    store.resetAgentState()
    store.setAgentState({
      activeChatId: this.config.activeChatId,
      runId,
      isRunning: true,
      isThinking: false,
      status: 'preparing_context',
      selectedSkills: this.config.selectedSkills,
      currentStepStartTime: Date.now(),
      harnessEvents: this.config.initialHarnessEvents || [],
    })
    if (!this.config.initialHarnessEvents?.length) {
      this.appendHarnessEvent({ kind: 'session/start', data: { conversationId: this.config.conversationId } })
    }
    this.appendHarnessEvent({ kind: 'turn/start', runId, data: { source: 'deepseek-harness' } })
    this.appendHarnessEvent({ kind: 'user/message', runId, data: { content: userInput } })
    this.appendHarnessEvent({ kind: 'run/start', runId, data: { runtime: 'deepseek-harness' } })

    try {
      const ai = await getAISettings()
      if (!ai?.baseURL || !ai.model) throw new Error('请先在 AI 设置中选择可用的主模型。')
      const workspace = await getWorkspacePath()
      const cwd = workspace.isCustom ? workspace.path : await getDefaultArticleAbsolutePath('')
      await deepSeekHarnessClient.start({ cwd, ai, permissionMode: this.config.permissionMode })
      if (this.stopped) return ''

      const contextBlocks: string[] = []
      if (typeof contextOrMessages === 'string' && contextOrMessages.trim()) {
        contextBlocks.push(contextOrMessages.trim())
      } else if (Array.isArray(contextOrMessages)) {
        const systemContext = contextOrMessages.flatMap(message => (
          message.role === 'system' && typeof message.content === 'string' ? [message.content] : []
        ))
        contextBlocks.push(...systemContext)
        if (!this.config.initialHarnessEvents?.length) {
          const history = contextOrMessages.flatMap(message => (
            (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string'
              ? [`${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`]
              : []
          ))
          if (history.length) contextBlocks.push(`<previous-conversation>\n${history.join('\n\n')}\n</previous-conversation>`)
        }
      }
      if (this.config.activeFilePath) {
        const editor = await readCurrentEditorState().catch(() => undefined)
        contextBlocks.push([
          '<active-note>',
          `Path: ${this.config.activeFilePath}`,
          editor?.numberedLines || '(The note content is unavailable; read it from the workspace if needed.)',
          '</active-note>',
        ].join('\n'))
      }
      let harnessInput = contextBlocks.length
        ? `<notegoal-context>\n${contextBlocks.join('\n\n')}\n</notegoal-context>\n\n${userInput}`
        : userInput
      const queuedSteering = this.pendingSteering.splice(0)
      if (queuedSteering.length) {
        harnessInput += queuedSteering.map(payload => (
          `\n\n<steering>\n${payload.additionalContext ? `${payload.additionalContext}\n\n` : ''}${payload.text}\n</steering>`
        )).join('')
      }

      const toolCalls = new Map<string, ToolCall>()
      const applyNotification = (notification: HarnessWireNotification) => {
        if (notification.method === 'session.status') {
          const running = notification.params.status === 'running'
          store.setAgentState({
            isRunning: running,
            isThinking: running,
            status: running ? 'thinking' : 'completed',
          })
          this.appendHarnessEvent({ kind: 'run/status', runId, data: { status: notification.params.status } })
          return
        }
        if (notification.method !== 'session.event') return
        const event = notification.params.event as HarnessWireEvent | undefined
        if (!event || typeof event.type !== 'string') return
        const data = event.data || {}
        const timestamp = typeof event.time === 'number' ? event.time : Date.now()

        if (event.type === 'assistant/chunk') {
          const chunk = data.chunk
          if (chunk && typeof chunk === 'object') {
            const typedChunk = chunk as Record<string, unknown>
            if (typedChunk.type === 'text-delta' && typeof typedChunk.text === 'string') {
              streamedContent += typedChunk.text
              store.setAgentState({
                isFinalAnswerMode: true,
                finalAnswerContent: streamedContent,
                isThinking: false,
                status: 'thinking',
              })
              this.config.onFinalAnswerRender?.(streamedContent)
            } else if (typedChunk.type === 'reasoning-delta' && typeof typedChunk.text === 'string') {
              const current = useChatStore.getState().agentState.currentThought || ''
              store.setAgentState({ currentThought: current + typedChunk.text, isThinking: true })
              this.config.onThought?.(typedChunk.text)
            }
          }
        } else if (event.type === 'tool/call') {
          const callId = String(data.callId || `${runId}-${event.seq}`)
          let params: Record<string, unknown> = {}
          if (typeof data.arguments === 'string') {
            try { params = JSON.parse(data.arguments) as Record<string, unknown> } catch { params = { raw: data.arguments } }
          }
          const call: ToolCall = {
            id: callId,
            toolName: String(data.name || 'unknown'),
            params,
            status: 'running',
            timestamp,
          }
          toolCalls.set(callId, call)
          this.upsertToolCall(call)
          store.setAgentState({ isThinking: false, status: 'calling_tool' })
        } else if (event.type === 'tool/result') {
          const message = data.message && typeof data.message === 'object'
            ? data.message as Record<string, unknown>
            : {}
          const callId = String(message.source && typeof message.source === 'object'
            ? (message.source as Record<string, unknown>).callId || ''
            : '')
          const existing = toolCalls.get(callId)
          if (existing) {
            const blocks = Array.isArray(message.content) ? message.content : []
            const output = blocks.flatMap(block => (
              block && typeof block === 'object' && typeof (block as Record<string, unknown>).text === 'string'
                ? [(block as Record<string, unknown>).text]
                : []
            )).join('')
            const failed = Boolean(data.error) || blocks.some(block => (
              block && typeof block === 'object' && (block as Record<string, unknown>).isError === true
            ))
            const completed: ToolCall = {
              ...existing,
              status: failed ? 'error' : 'success',
              result: failed
                ? { success: false, error: output }
                : { success: true, data: output, message: output },
            }
            toolCalls.set(callId, completed)
            this.upsertToolCall(completed)
          }
        } else if (event.type === 'step/end') {
          this.appendStep({ thought: 'Harness 完成一个 Agent 步骤' })
        } else if (event.type === 'turn/end') {
          this.appendHarnessEvent({ kind: 'run/end', runId, timestamp, data })
        }

        this.appendHarnessEvent({
          kind: event.type === 'tool/call' || event.type === 'tool/result' || event.type === 'assistant/message'
            ? event.type
            : 'trace/event',
          runId,
          timestamp,
          data: { ...data, upstreamType: event.type, sequence: event.seq },
        })
      }

      this.harnessActive = true
      const result = await deepSeekHarnessClient.run(this.harnessSessionId, harnessInput, {
        onNotification: applyNotification,
        onRequest: async request => {
          if (request.method === 'user.approval') {
            const callId = typeof request.params.callId === 'string' ? request.params.callId : ''
            const call = toolCalls.get(callId)
            const toolName = typeof request.params.toolName === 'string'
              ? request.params.toolName
              : call?.toolName || 'Harness 操作'
            const params = call?.params || {
              ...(callId ? { callId } : {}),
              ...(typeof request.params.reason === 'string' ? { reason: request.params.reason } : {}),
            }
            store.setAgentState({ status: 'waiting_approval', isThinking: false, isRunning: true })
            const decision = await this.config.requestConfirmation?.(toolName, params) || 'denied'
            return decision === 'approved'
              ? 'allowed-once'
              : decision === 'steered' ? 'cancelled' : 'rejected'
          }
          if (request.method === 'user.questions') {
            const questions = Array.isArray(request.params.questions)
              ? request.params.questions.filter((question): question is HarnessQuestion => (
                  Boolean(question)
                  && typeof question === 'object'
                  && typeof (question as { id?: unknown }).id === 'string'
                  && typeof (question as { question?: unknown }).question === 'string'
                ))
              : []
            if (!questions.length) throw new Error('Harness 发出了空的问题请求。')
            store.setAgentState({ isThinking: false, isRunning: true })
            return requestHarnessQuestions(questions)
          }
          throw new Error(`不支持的 Harness 客户端请求：${request.method}`)
        },
      })
      const content = result.finalResponse || streamedContent
      store.setAgentState({
        isRunning: false,
        isThinking: false,
        status: this.stopped ? 'stopped' : 'completed',
        isFinalAnswerMode: true,
        finalAnswerContent: content,
      })
      this.appendHarnessEvent({ kind: 'assistant/message', runId, data: { content } })
      this.config.onFinalAnswerRender?.(content)
      this.config.onComplete?.(content, useChatStore.getState().agentState.completedSteps, this.stopped)
      return content
    } catch (error) {
      if (this.stopped) {
        const partial = useChatStore.getState().agentState.finalAnswerContent || streamedContent
        store.setAgentState({ isRunning: false, isThinking: false, status: 'stopped' })
        this.appendHarnessEvent({ kind: 'run/stopped', runId, data: { content: partial } })
        this.config.onComplete?.(partial, useChatStore.getState().agentState.completedSteps, true)
        return partial
      }
      const message = error instanceof Error ? error.message : String(error)
      store.setAgentState({ isRunning: false, isThinking: false, status: 'failed' })
      this.appendHarnessEvent({ kind: 'run/error', runId, data: { message } })
      this.config.onError?.(message)
      throw error
    } finally {
      this.harnessActive = false
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
    cancelHarnessQuestions()
    void deepSeekHarnessClient.stop().catch(() => {})
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
    if (this.harnessActive) {
      const input = payload.additionalContext
        ? `<notegoal-context>\n${payload.additionalContext}\n</notegoal-context>\n\n${payload.text}`
        : payload.text
      void deepSeekHarnessClient.followup(this.harnessSessionId, input).catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        useChatStore.getState().setAgentState({ status: 'failed', isRunning: false, isThinking: false })
        this.config.onError?.(message)
      })
    } else if (this.runtime) {
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
    this.appendHarnessEvent({
      kind: 'trace/event',
      runId: event.runId,
      timestamp: event.timestamp,
      data: event,
    })
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
    this.appendHarnessEvent({
      kind: toolCall.status === 'success' || toolCall.status === 'error' ? 'tool/result' : 'tool/call',
      runId: currentState.agentState.runId,
      timestamp: toolCall.timestamp,
      data: toolCall,
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
    this.appendHarnessEvent({
      kind: 'step/complete',
      runId: current.runId,
      data: step,
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
