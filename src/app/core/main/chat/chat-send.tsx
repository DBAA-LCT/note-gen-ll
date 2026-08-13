"use client"
import { Send, Square } from "lucide-react"
import useSettingStore from "@/stores/setting"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import { TooltipButton } from "@/components/tooltip-button"
import { useEffect, useImperativeHandle, forwardRef, useRef } from "react"
import { useTranslations } from "next-intl"
import { LinkedResource, isLinkedFolder, type MarkdownFile } from "@/lib/files"
import { readTextFile } from "@tauri-apps/plugin-fs"
import { getDefaultArticleAbsolutePath, getFilePathOptions, getWorkspacePath } from "@/lib/workspace"
import { AgentHandler } from "@/lib/agent/agent-handler"
import { isRequestAbortError } from "@/lib/agent/runtime"
import { agentDebugLog, previewText } from "@/lib/agent/debug-log"
import { getToolByName } from "@/lib/agent/tools"
import { getSessionApprovalScope, matchesSessionApproval } from "@/lib/agent/session-approval"
import { ImageAttachment } from "./image-attachments"
import { cn } from "@/lib/utils"
import type { AgentTraceEvent } from "@/lib/agent/types"
import type { AgentApprovalDecision, AgentSteeringPayload } from "@/lib/agent/types"
import { serializeChatAttachments, type RuntimeChatAttachment } from '@/lib/chat-attachments'
import { retainCompletedAgentTraceEvents } from '@/lib/agent/trace-retention'
import { getAISettings } from '@/lib/ai/utils'
import {
  buildChatImageContext,
  buildHistoricalImageContext,
  collectAgentImageAttachments,
  createPendingChatImageAnalyses,
  serializeChatImageAnalyses,
  type PersistedChatImageAnalysis,
} from '@/lib/chat-image-context'
import type { Chat } from '@/db/chats'
import {
  confirmEstimatedContextWindow,
  learnContextWindow,
  parseContextOverflowError,
  reduceLearnedContextWindow,
} from '@/lib/ai/model-capacity'
import emitter from '@/lib/emitter'
function getLastDisplayableAgentContent(
  liveContent: string | undefined,
  traceEvents: AgentTraceEvent[]
) {
  const currentContent = liveContent?.trim()
  if (currentContent) {
    return currentContent
  }

  for (let index = traceEvents.length - 1; index >= 0; index -= 1) {
    const event = traceEvents[index]
    if (
      (event.type === 'model_call' || event.type === 'model_response')
      && typeof event.output === 'string'
      && event.output.trim()
    ) {
      return event.output.trim()
    }

    if (event.type === 'final' && event.message?.trim()) {
      return event.message.trim()
    }
  }

  return ''
}

function isUnknownProviderError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  return /500 Internal Server Error/i.test(text)
    && /"code"\s*:\s*60000/.test(text)
    && /Unknown error/i.test(text)
}

interface QuoteData {
  quote: string
  fullContent: string
  fileName: string
  startLine: number
  endLine: number
  from: number
  to: number
  articlePath: string
}

interface ChatSendProps {
  inputValue: string;
  onSent?: () => void;
  linkedResource?: LinkedResource | null;
  attachedImages?: ImageAttachment[];
  fileAttachments?: RuntimeChatAttachment[];
  quoteData?: QuoteData | null;
  selectedSkillIds?: string[];
  mentionedFiles?: MarkdownFile[];
  mentionedRecords?: QuoteData[];
  dockStyle?: boolean;
}

export const ChatSend = forwardRef<{ sendChat: () => void }, ChatSendProps>(({
  inputValue,
  onSent,
  linkedResource,
  attachedImages = [],
  fileAttachments = [],
  quoteData = null,
  selectedSkillIds = [],
  mentionedFiles = [],
  mentionedRecords = [],
  dockStyle = false,
}, ref) => {
  const { primaryModel, agentPermissionMode } = useSettingStore()
  const { currentTagId } = useTagStore()
  const {
    insert,
    loading,
    setLoading,
    saveChat,
    setAgentState,
    linkedResourcePreview,
  } = useChatStore()
  const abortControllerRef = useRef<AbortController | null>(null)
  const imageAnalysisAbortControllerRef = useRef<AbortController | null>(null)
  const agentHandlerRef = useRef<AgentHandler | null>(null)
  const manualStopRequestedRef = useRef(false)
  const steeringSequenceRef = useRef(0)
  const steeringChainRef = useRef<Promise<void>>(Promise.resolve())
  const pendingSteeringRef = useRef<AgentSteeringPayload[]>([])
  const activeRunRef = useRef(false)
  const repeatedScriptApprovalRef = useRef<{ signature: string; count: number }>({ signature: '', count: 0 })
  const contextOverflowRetryRef = useRef(0)
  const recentSubmissionRef = useRef<{ fingerprint: string; timestamp: number } | null>(null)
  const regenerateResponseRef = useRef<(assistantChatId: number) => Promise<void>>(async () => {})
  const t = useTranslations()
  const requestText = inputValue.trim() || t('record.chat.input.addAttachment.attachmentOnlyPrompt')

  const buildPartialSuccessContent = (result: string, toolCalls: { result?: { success?: boolean; data?: any; error?: string } }[]) => {
    const generatedOutputFiles = toolCalls.flatMap((toolCall) => {
      const outputFiles = toolCall.result?.data?.output_files
      return Array.isArray(outputFiles) ? outputFiles : []
    })

    const uniqueOutputFiles = Array.from(new Set(generatedOutputFiles.filter((file): file is string => typeof file === 'string' && file.trim().length > 0)))
    if (uniqueOutputFiles.length === 0) {
      return null
    }

    const failedToolCall = [...toolCalls].reverse().find((toolCall) => toolCall.result?.success === false)
    const failureMessage = failedToolCall?.result?.error || result

    return [
      `已成功生成文件：`,
      uniqueOutputFiles.map((file) => `- ${file}`).join('\n'),
      '',
      `后续校验或附加步骤失败：${failureMessage}`,
    ].join('\n')
  }

  const sanitizeAgentFinalContent = (content: string) => {
    const trimmed = content.trim()
    if (!trimmed) {
      return trimmed
    }

    const markers = ['\nThought:', '\nAction:', '\nAction Input:']
    let cutoff = trimmed.length

    for (const marker of markers) {
      const index = trimmed.indexOf(marker)
      if (index !== -1) {
        cutoff = Math.min(cutoff, index)
      }
    }

    const leadingActionIndex = trimmed.search(/^(Thought:|Action:|Action Input:)/)
    if (leadingActionIndex === 0) {
      const finalAnswerMatch = trimmed.match(/Final Answer[:：]\s*([\s\S]*)/i)
      if (finalAnswerMatch) {
        return finalAnswerMatch[1].trim()
      }
    }

    return trimmed.slice(0, cutoff).trim()
  }

  const buildSteeringContext = async () => {
    const useArticleStore = (await import('@/stores/article')).default
    const articleStore = useArticleStore.getState()
    let context = ''

    if (articleStore.activeFilePath && articleStore.currentArticle) {
      context += `## 当前打开的笔记\n文件路径: ${articleStore.activeFilePath}\n\n内容:\n${articleStore.currentArticle}\n\n`
    }

    if (linkedResource && isLinkedFolder(linkedResource)) {
      context += `## 用户关联的笔记文件夹\n用户关联了文件夹“${linkedResource.name}”（${linkedResource.relativePath}）。需要查找笔记时优先使用这个 folderPath。\n\n`
    }

    if (linkedResource && !isLinkedFolder(linkedResource)) {
      try {
        const workspace = await getWorkspacePath()
        const pathOptions = workspace.isCustom ? null : await getFilePathOptions(linkedResource.path)
        const linkedFileContent = workspace.isCustom
          ? await readTextFile(linkedResource.path)
          : await readTextFile(pathOptions!.path, {
              baseDir: pathOptions!.baseDir,
            })
        context += `${linkedResourcePreview ? `${linkedResourcePreview}\n` : ''}## 关联文件完整内容\n${linkedResource.relativePath}\n\n${linkedFileContent}\n\n`
      } catch (error) {
        console.error('Failed to read linked file for steering:', error)
      }
    }

    if (quoteData) {
      context += `## 用户引用内容\n文件: ${quoteData.fileName}\n范围: ${quoteData.from}-${quoteData.to}\n\n${quoteData.fullContent}\n\n`
    }

    context += await buildMentionedContext()

    return context
  }

  const buildMentionedContext = async () => {
    let context = ''

    for (const file of mentionedFiles) {
      try {
        const workspace = await getWorkspacePath()
        const content = workspace.isCustom
          ? await readTextFile(file.path)
          : await getFilePathOptions(file.path).then(({ path, baseDir }) =>
              readTextFile(path, { baseDir })
            )
        context += [
          '## 用户通过 @ 关联的文件',
          `文件：${file.relativePath}`,
          '',
          content,
          '',
        ].join('\n')
      } catch (error) {
        console.error('Failed to read @ mentioned file:', error)
      }
    }

    for (const record of mentionedRecords) {
      context += [
        '## 用户通过 @ 关联的记录',
        `记录：${record.fileName}`,
        '',
        record.fullContent,
        '',
      ].join('\n')
    }

    return context
  }

  const startProactiveCompaction = () => {
    const chatState = useChatStore.getState()
    if (
      chatState.isTemporaryConversation
      || !chatState.currentConversationId
    ) {
      return
    }

    const conversationId = chatState.currentConversationId
    void Promise.all([
      import('@/lib/ai/condense'),
      import('@/stores/article'),
    ])
      .then(([{ prepareConversationHistory }, { default: useArticleStore }]) => {
        const latestChatState = useChatStore.getState()
        if (latestChatState.currentConversationId !== conversationId) {
          return
        }

        const articleState = useArticleStore.getState()
        const additionalContext = articleState.activeFilePath
          ? articleState.currentArticle || ''
          : ''

        return prepareConversationHistory({
          conversationId,
          chats: latestChatState.chats,
          currentUserInput: '',
          additionalContext,
          imageCount: 0,
          proactive: true,
        })
      })
      .catch(error => {
        console.error('[ConversationCompaction] Background compaction failed:', error)
      })
  }

  useImperativeHandle(ref, () => ({
    sendChat: handleSubmit
  }))

  // Agent 确认回调 - 使用内联确认而不是弹窗
  const requestConfirmation = (
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
  ): Promise<AgentApprovalDecision> => {
    const tool = getToolByName(toolName)
    const sessionApprovalScope = getSessionApprovalScope(toolName, tool, params)
    const canApproveForSession = !!sessionApprovalScope
    const approvalSignature = sessionApprovalScope
      ? `${toolName}:${JSON.stringify(params)}`
      : ''
    if (approvalSignature) {
      repeatedScriptApprovalRef.current = repeatedScriptApprovalRef.current.signature === approvalSignature
        ? { signature: approvalSignature, count: repeatedScriptApprovalRef.current.count + 1 }
        : { signature: approvalSignature, count: 1 }
    }
    const requiresRepeatConfirmation = repeatedScriptApprovalRef.current.count >= 3
    if (requiresRepeatConfirmation) {
      repeatedScriptApprovalRef.current = { signature: '', count: 0 }
    }

    const currentChatState = useChatStore.getState()
    const activeConversationId = currentChatState.currentConversationId
    const autoApproveConversationId = currentChatState.agentAutoApproveConversationId
    const autoApproveRuntimeScriptKey = currentChatState.agentAutoApproveRuntimeScriptKey

    if (!requiresRepeatConfirmation && matchesSessionApproval(
      autoApproveConversationId,
      activeConversationId,
      autoApproveRuntimeScriptKey,
      sessionApprovalScope
    )) {
      agentDebugLog('approval_auto_approved', {
        toolName,
        params,
        activeConversationId,
        sessionApprovalScope,
      })
      return Promise.resolve('approved')
    }

    return new Promise((resolve) => {
      agentDebugLog('approval_pending_set', {
        toolName,
        params,
        context,
        canApproveForSession,
        sessionApprovalScope,
      })

      // 将确认请求保存到 store，在对话中显示
      setAgentState({
        pendingConfirmation: {
          toolName,
          params,
          previewParams: context?.previewParams,
          ...context,
          canApproveForSession,
          sessionApprovalType: sessionApprovalScope?.type,
          sessionApprovalKey: sessionApprovalScope?.permissionKey,
        }
      })
      
      // 轮询检查用户是否已确认或取消
      const checkInterval = setInterval(() => {
        const currentState = useChatStore.getState()
        
        // 如果 pendingConfirmation 被清除，说明用户已操作
        if (!currentState.agentState.pendingConfirmation) {
          clearInterval(checkInterval)
          const latestRecord = [...currentState.agentState.confirmationHistory]
            .reverse()
            .find((record) =>
              record.toolName === toolName &&
              JSON.stringify(record.params) === JSON.stringify(params)
            )

          agentDebugLog('approval_pending_resolved', {
            toolName,
            params,
            latestRecord,
            resolved: latestRecord?.status === 'confirmed',
          })

          resolve(latestRecord?.status === 'confirmed'
            ? 'approved'
            : latestRecord?.status === 'superseded'
              ? 'steered'
              : 'denied')
        }
      }, 100)
    })
  }

  // Agent 模式处理
  async function handleAgentMode(
    images: ImageAttachment[],
    userMessage: Chat,
    regeneration?: { requestText: string; quoteData?: QuoteData | null; selectedSkills?: string[] }
  ) {
    const effectiveRequestText = regeneration?.requestText ?? requestText
    const effectiveQuoteData = regeneration ? regeneration.quoteData : quoteData
    const effectiveSelectedSkills = regeneration?.selectedSkills ?? selectedSkillIds
    // 先创建一个占位的 AI 消息
    const placeholderMessage = await insert({
      tagId: currentTagId,
      role: 'system',
      content: '',
      type: 'chat',
      inserted: false,
    })

    if (!placeholderMessage) return

    setAgentState({
      activeChatId: placeholderMessage.id,
    })

    const useArticleStore = (await import('@/stores/article')).default
    const articleStore = useArticleStore.getState()
    let pendingCapacityProbe: { contextWindow: number } | undefined
    let deferredOverflowError: string | undefined
    let contextCapacityProbeActive = false
    const agentImageAttachments = collectAgentImageAttachments(
      useChatStore.getState().chats.filter(chat => chat.id !== userMessage.id)
    )

    const persistAgentError = async (error: string) => {
      const currentState = useChatStore.getState()
      const currentMessage = currentState.chats.find(c => c.id === placeholderMessage.id)
      const resolvedRagSources = currentState.agentState.ragSources?.length
        ? JSON.stringify(currentState.agentState.ragSources)
        : currentMessage?.ragSources
      const resolvedRagSourceDetails = currentState.agentState.ragSourceDetails?.length
        ? JSON.stringify(currentState.agentState.ragSourceDetails)
        : currentMessage?.ragSourceDetails
      const aborted = manualStopRequestedRef.current || isRequestAbortError(error)
      const preservedContent = getLastDisplayableAgentContent(
        currentState.agentState.finalAnswerContent,
        currentState.agentState.traceEvents || []
      )
      const stoppedAt = Date.now()
      const completedTraceEvents = (currentState.agentState.traceEvents || []).map(event => {
        if (event.status !== 'running') {
          return event
        }

        return {
          ...event,
          status: aborted ? 'success' as const : 'error' as const,
          duration: event.duration ?? Math.max(0, stoppedAt - event.timestamp),
        }
      })
      const traceEvents = retainCompletedAgentTraceEvents(completedTraceEvents)
      const agentHistory = {
        steps: currentState.agentState.completedSteps || [],
        toolCalls: currentState.agentState.toolCalls,
        traceEvents,
        changes: currentState.agentState.changes || [],
        runId: currentState.agentState.runId,
        status: aborted ? 'stopped' : 'failed',
        loadedSkills: currentState.agentState.loadedSkills || [],
        selectedSkills: currentState.agentState.selectedSkills || [],
        iterations: currentState.agentState.currentIteration,
      }

      await saveChat({
        id: placeholderMessage.id,
        tagId: placeholderMessage.tagId,
        conversationId: placeholderMessage.conversationId,
        role: placeholderMessage.role,
        type: placeholderMessage.type,
        inserted: placeholderMessage.inserted,
        createdAt: placeholderMessage.createdAt,
        ragSources: resolvedRagSources,
        ragSourceDetails: resolvedRagSourceDetails,
        content: aborted
          ? preservedContent || t('record.chat.input.stopped')
          : `Error: ${error}`,
        agentHistory: JSON.stringify(agentHistory),
      }, true)

      setAgentState({
        activeChatId: undefined,
        isFinalAnswerMode: false,
        finalAnswerContent: undefined,
        status: aborted ? 'stopped' : 'failed',
        isRunning: false,
        isThinking: false,
        traceEvents,
      })
      agentHandlerRef.current = null
    }

    const configuredWorkspace = await getWorkspacePath()
    const agentWorkspacePath = configuredWorkspace.isCustom
      ? configuredWorkspace.path
      : await getDefaultArticleAbsolutePath('')

    // 每次都创建新的 AgentHandler，使用当前的 placeholderMessage
    const agentHandler = new AgentHandler({
      activeChatId: placeholderMessage.id,
      conversationId: placeholderMessage.conversationId,
      workspaceId: agentWorkspacePath.trim().replace(/\\/g, '/').replace(/\/+$/, ''),
      useMemories: !useChatStore.getState().isTemporaryConversation,
      activeFilePath: articleStore.activeFilePath,
      permissionMode: agentPermissionMode,
      requestConfirmation,
      currentQuote: effectiveQuoteData
        ? {
            fileName: effectiveQuoteData.fileName,
            startLine: effectiveQuoteData.startLine,
            endLine: effectiveQuoteData.endLine,
            from: effectiveQuoteData.from,
            to: effectiveQuoteData.to,
            fullContent: effectiveQuoteData.fullContent,
          }
        : undefined,
      attachments: fileAttachments,
      imageAttachments: agentImageAttachments,
      selectedSkills: effectiveSelectedSkills,
      onFinalAnswerRender: (markdownContent) => {
        // 检测到 Final Answer 时触发渲染
        setAgentState({
          activeChatId: placeholderMessage.id,
          isFinalAnswerMode: true,
          finalAnswerContent: markdownContent
        })
      },
      formatAutoFinalAnswer: (key, values) => t(key as any, values),
      onComplete: async (result, steps, stopped) => {
        deferredOverflowError = undefined
        // 获取 Agent 执行历史，保存结构化运行轨迹
        const { agentState } = useChatStore.getState()
        const effectivelyStopped = Boolean(stopped)
          || manualStopRequestedRef.current
          || isRequestAbortError(result)
        if (!effectivelyStopped && pendingCapacityProbe) {
          const aiConfig = await getAISettings('primaryModel')
          if (aiConfig) {
            await confirmEstimatedContextWindow(
              aiConfig,
              pendingCapacityProbe.contextWindow
            )
          }
          pendingCapacityProbe = undefined
        }
        const completedAt = Date.now()
        const completedTraceEvents = (agentState.traceEvents || []).map(event => {
          if (event.status !== 'running') {
            return event
          }

          return {
            ...event,
            status: effectivelyStopped ? 'success' as const : event.status,
            duration: event.duration ?? Math.max(0, completedAt - event.timestamp),
          }
        })
        const traceEvents = retainCompletedAgentTraceEvents(completedTraceEvents)
        // 使用 agentState.completedSteps 而不是 steps 参数，因为 completedSteps 包含 duration 信息
        const agentHistory = {
          steps: agentState.completedSteps || [],
          toolCalls: agentState.toolCalls,
          traceEvents,
          changes: agentState.changes || [],
          runId: agentState.runId,
          status: effectivelyStopped ? 'stopped' : agentState.status,
          loadedSkills: agentState.loadedSkills || [],
          selectedSkills: agentState.selectedSkills || [],
          iterations: agentState.currentIteration,
        }

        let finalContent = result
        if (effectivelyStopped) {
          const lastDisplayableContent = getLastDisplayableAgentContent(
            agentState.finalAnswerContent,
            completedTraceEvents
          )
          if (lastDisplayableContent) {
            finalContent = lastDisplayableContent
          } else if (isRequestAbortError(finalContent)) {
            finalContent = ''
          }
        }
        if (effectivelyStopped && !finalContent.trim()) {
          // 只有尚未产生任何正文时才显示终止提示；已有的流式正文原样保留。
          finalContent = t('record.chat.input.stopped')
        }

        if (!effectivelyStopped) {
          const partialSuccessContent = buildPartialSuccessContent(result, agentState.toolCalls)
          if (partialSuccessContent && /^工具 .+执行失败：|^工具 .+执行出错：|^Error:/.test(finalContent.trim())) {
            finalContent = partialSuccessContent
          }
        }

        finalContent = sanitizeAgentFinalContent(finalContent)

        const currentState = useChatStore.getState()
        const currentMessage = currentState.chats.find(c => c.id === placeholderMessage.id)
        const resolvedRagSources = agentState.ragSources?.length
          ? JSON.stringify(agentState.ragSources)
          : currentMessage?.ragSources
        const resolvedRagSourceDetails = agentState.ragSourceDetails?.length
          ? JSON.stringify(agentState.ragSourceDetails)
          : currentMessage?.ragSourceDetails

        // 更新占位消息，保留 RAG 相关字段
        await saveChat({
          id: placeholderMessage.id,
          tagId: placeholderMessage.tagId,
          conversationId: placeholderMessage.conversationId,
          role: placeholderMessage.role,
          type: placeholderMessage.type,
          inserted: placeholderMessage.inserted,
          createdAt: placeholderMessage.createdAt,
          ragSources: resolvedRagSources,
          ragSourceDetails: resolvedRagSourceDetails,
          // 设置新的内容
          content: finalContent,
          agentHistory: JSON.stringify(agentHistory),
        }, true)

        // 清空 Final Answer 模式状态
        setAgentState({
          activeChatId: undefined,
          isFinalAnswerMode: false,
          finalAnswerContent: undefined,
          traceEvents,
        })

        if (!effectivelyStopped) {
          startProactiveCompaction()
          const { scheduleConversationMemoryExtraction } = await import('@/lib/memory/auto-memory')
          scheduleConversationMemoryExtraction(placeholderMessage.conversationId)
        }

        // 清空 ref
        agentHandlerRef.current = null
      },
      onError: async (error) => {
        const parsedOverflow = parseContextOverflowError(error)
        const inferredOverflow =
          !parsedOverflow.detected
          && contextCapacityProbeActive
          && isUnknownProviderError(error)
        const overflow = inferredOverflow
          ? { detected: true }
          : parsedOverflow
        if (inferredOverflow) {
          agentDebugLog('context_overflow_inferred_from_provider_error', {
            error,
            reason: 'unknown_provider_error_during_capacity_probe',
          })
        }
        if (overflow.detected) {
          const aiConfig = await getAISettings('primaryModel')
          if (aiConfig) {
            if (overflow.contextWindow) {
              await learnContextWindow(aiConfig, overflow.contextWindow)
            } else {
              await reduceLearnedContextWindow(aiConfig)
            }
          }
        }

        const currentState = useChatStore.getState()
        const canRecoverFromOverflow =
          overflow.detected
          && contextOverflowRetryRef.current === 0
          && currentState.agentState.toolCalls.length === 0
          && !currentState.isTemporaryConversation
          && Boolean(currentState.currentConversationId)
        if (canRecoverFromOverflow) {
          deferredOverflowError = error
          agentDebugLog('context_overflow_error_deferred', {
            conversationId: currentState.currentConversationId,
            contextWindow: overflow.contextWindow || null,
          })
          return
        }

        deferredOverflowError = undefined
        await persistAgentError(error)
      },
    })

    // 保存到 ref
    agentHandlerRef.current = agentHandler
    for (const payload of pendingSteeringRef.current.splice(0)) {
      agentHandler.steer(payload)
    }

    try {
      // 构建上下文信息
      let context = ''

      // 1. 图片先由专用视觉模型识别，失败时回退 OCR。
      // 主聊天模型只接收结构化识别结果，不依赖自身的视觉能力。
      if (images.length > 0) {
        imageAnalysisAbortControllerRef.current?.abort()
        const imageAnalysisAbortController = new AbortController()
        imageAnalysisAbortControllerRef.current = imageAnalysisAbortController
        let liveAnalyses = createPendingChatImageAnalyses(images, effectiveRequestText)
        const updatePersistedAnalysis = (analyses: PersistedChatImageAnalysis[], persist: boolean) => {
          const updatedMessage = {
            ...userMessage,
            imageAnalyses: serializeChatImageAnalyses(analyses),
          }
          if (persist) {
            return saveChat(updatedMessage, true)
          } else {
            useChatStore.getState().updateChat(updatedMessage)
          }
        }

        setAgentState({
          status: 'analyzing_images',
          isRunning: true,
          isThinking: false,
        })
        const imageResult = await buildChatImageContext(images, effectiveRequestText, {
          signal: imageAnalysisAbortController.signal,
          onProgress: (progress) => {
            liveAnalyses = liveAnalyses.map(analysis => (
              analysis.imageId === progress.imageId
                ? {
                    ...analysis,
                    status: progress.status,
                    method: progress.method ?? analysis.method,
                    errorCode: progress.errorCode,
                    updatedAt: Date.now(),
                  }
                : analysis
            ))
            updatePersistedAnalysis(liveAnalyses, false)
          },
        })
        imageAnalysisAbortControllerRef.current = null
        await updatePersistedAnalysis(imageResult.analyses, true)
        agentImageAttachments.push(...imageResult.analyses.map(analysis => ({
          ...analysis,
          chatId: userMessage.id,
        })))
        if (imageResult.context) {
          context += `${imageResult.context}\n`
        }

        agentDebugLog('chat_context_images_analyzed', {
          imageCount: images.length,
          contextLength: imageResult.context.length,
          preview: previewText(imageResult.context),
        })
      }

      const historicalImageContext = buildHistoricalImageContext(
        useChatStore.getState().chats.filter(chat => chat.id !== userMessage.id)
      )
      if (historicalImageContext) {
        context += `${historicalImageContext}\n`
      }

      // 2. 当前编辑器内容由 AgentHandler 在模型调用前读取实时快照并注入系统提示词。
      // 这里不再重复追加 currentArticle，避免同一篇正文占用两份上下文。

      agentDebugLog('chat_context_active_note', {
        activeFilePath: articleStore.activeFilePath || null,
        currentArticleLength: articleStore.currentArticle?.length || 0,
        injected: false,
        injectedByRuntimeSnapshot: Boolean(articleStore.activeFilePath),
        preview: previewText(articleStore.currentArticle || ''),
      })
      const activeEditorTab = articleStore.openTabs.find(tab => tab.id === articleStore.activeTabId)
      if (activeEditorTab?.kind === 'learning' || activeEditorTab?.path.startsWith('learning://')) {
        const { buildLearningWorkspaceContext } = await import('@/lib/learning/ai-context')
        context += `\n${await buildLearningWorkspaceContext()}\n`
      }
      // 3. 关联文件夹作为 Agent 自动检索时的优先范围，不在发送前预先检索。
      if (linkedResource && isLinkedFolder(linkedResource)) {
        context += [
          '## 用户关联的笔记文件夹',
          `用户关联了文件夹“${linkedResource.name}”（${linkedResource.relativePath}）。`,
          '如果当前请求需要查找用户资料，请优先使用 knowledge_search，并将 folderPath 设置为这个相对路径。不要在没有必要时搜索。',
          '',
        ].join('\n')
      }

      // 4. 如果有关联文件（非文件夹），始终注入完整内容作为 Agent 上下文
      const linkedResourceIsActiveFile = linkedResource && !isLinkedFolder(linkedResource) && (
        linkedResource.relativePath === articleStore.activeFilePath ||
        linkedResource.path === articleStore.activeFilePath ||
        linkedResource.name === articleStore.activeFilePath.split('/').pop()
      )

      if (linkedResource && !isLinkedFolder(linkedResource) && !linkedResourceIsActiveFile) {
        try {
          const workspace = await getWorkspacePath()
          let linkedFileContent = ''
          if (workspace.isCustom) {
            linkedFileContent = await readTextFile(linkedResource.path)
          } else {
            const { path, baseDir } = await getFilePathOptions(linkedResource.path)
            linkedFileContent = await readTextFile(path, { baseDir })
          }

          if (linkedResourcePreview) {
            context += `\n${linkedResourcePreview}\n`
          }

          if (linkedFileContent) {
            context += `\n## 关联文件完整内容\n\nThe full content of the linked file "${linkedResource.name}" (${linkedResource.relativePath}) is already included below. Do not call tools to read or check this same file again unless the user explicitly asks to refresh it.\n\n---\n${linkedFileContent}\n---\n`
          }

          agentDebugLog('chat_context_linked_file', {
            name: linkedResource.name,
            relativePath: linkedResource.relativePath,
            contentLength: linkedFileContent.length,
            hasPreview: Boolean(linkedResourcePreview),
          })
        } catch (error) {
          console.error('Failed to read linked file in Agent mode:', error)
        }
      } else if (linkedResourceIsActiveFile) {
        agentDebugLog('chat_context_linked_file_skipped', {
          reason: 'linked file is already the active editor file',
          name: linkedResource.name,
          relativePath: linkedResource.relativePath,
        })
      }

      // 5. 如果有引用内容，添加引用上下文（在构建消息之前）
      if (effectiveQuoteData) {
        const { fileName, startLine, endLine, fullContent, from, to } = effectiveQuoteData
        let lineInfo = ''
        const hasValidLineNumbers = startLine !== -1 && endLine !== -1
        const hasValidRange = from >= 0 && to >= from

        if (hasValidLineNumbers) {
          if (startLine === endLine) {
            lineInfo = `第 ${startLine} 行`
          } else {
            lineInfo = `第 ${startLine}-${endLine} 行`
          }
        }

        context += `\n## 📌 用户引用内容

用户引用了笔记 "${fileName}" ${lineInfo}的以下内容：

---
${fullContent}
---

${hasValidRange ? `**仅在用户明确要求修改/改写/补充/插入时才允许编辑**。

如果用户是在提问、解释、总结、分析、询问译法、润色建议、代码说明，应该直接基于这段引用内容回答，**不要调用任何编辑工具**。

如果用户明确说“这句/这段/选中内容翻译成某种语言”，这是编辑请求，必须直接使用 editor_replace_range；已有 from/to 已足够，禁止再调用 editor_get_state 或 editor_get_selection。

**🚨 当且仅当用户明确要求修改时，必须精确替换用户选中的范围**: 当前引用内容来自编辑器选区，必须优先使用 editor_replace_range，只替换这段选中的内容：
- from: ${from}
- to: ${to}
- 使用 content 传入新内容
- 只允许替换这个选区，禁止扩大到整篇文档或整段之外

**如果用户说“在这段前面/后面/上面/下面插入、补充、添加”**:
- 仍然使用 editor_replace_range
- 基于当前引用范围整体替换
- 前插: 新内容 + 原引用内容
- 后插: 原引用内容 + 新内容
- 不要使用 editor_insert_at_cursor，因为聊天输入会让编辑器失焦，当前光标位置不可靠

**如果用户明确要求“前面和后面都增加内容”**:
- 仍然使用 editor_replace_range
- content 直接传入最终替换内容：前插内容 + 原引用内容 + 后插内容
- 不要使用额外协议标记；工具会把 content 原样写入选区

**兜底行号信息**:
- 单行修改: startLine: ${startLine}, endLine: ${endLine}
- 多行范围: startLine: ${startLine}, endLine: ${endLine}

**禁止**:
- 禁止在解释/分析类请求中调用编辑工具
- 禁止改动选区之外的内容
- 禁止获取整个文档后再重写整篇
- 禁止把 startLine/endLine 擅自改成 1/1` : hasValidLineNumbers ? `**仅在用户明确要求修改/改写/补充/插入时才允许编辑**。

如果用户是在提问、解释、总结、分析、询问译法、润色建议、代码说明，应该直接基于这段引用内容回答，**不要调用任何编辑工具**。

如果用户明确说“这句/这段/选中内容翻译成某种语言”，这是编辑请求，必须直接使用 editor_replace_lines；已有行号已足够，禁止再调用 editor_get_state 或 editor_get_selection。

**🚨 当且仅当用户明确要求修改时，必须使用行号修改**: 当用户引用内容并要求修改时，你必须使用 editor_replace_lines，传入精确的行号：
- 单行修改: startLine: ${startLine}, endLine: ${endLine}
- 多行范围: startLine: ${startLine}, endLine: ${endLine}
- 必须使用 replaceContent 参数传入新内容

**禁止**:
- 禁止在解释/分析类请求中调用编辑工具
- 禁止使用 from/to 位置参数
- 禁止使用 searchContent 文本搜索模式
- 禁止获取整个文档内容后再操作` : `**注意**: 此引用内容没有有效的行号信息。如果需要修改，请先使用 editor_get_selection 工具获取当前选中的行号信息。`}

请基于这段引用内容回答用户的问题。

`

        agentDebugLog('chat_context_quote', {
          fileName,
          startLine,
          endLine,
          from,
          to,
          quoteLength: effectiveQuoteData.quote.length,
          contentLength: fullContent.length,
          quotePreview: previewText(effectiveQuoteData.quote),
          fullContentPreview: previewText(fullContent),
          hasValidRange,
        })
      }

      if (!regeneration) context += await buildMentionedContext()

      // 6. 构建消息数组：较早回合使用会话级锚定摘要，最近完整回合保留原文
      const compactionContext = [
        context,
        articleStore.activeFilePath ? articleStore.currentArticle || '' : '',
      ].filter(Boolean).join('\n\n')
      const chatState = useChatStore.getState()
      const { chats } = chatState
      const {
        buildMessagesWithHistory,
        prepareConversationHistory,
      } = await import('@/lib/ai/condense')
      let preparedHistory: Awaited<ReturnType<typeof prepareConversationHistory>> | null = null
      if (!chatState.isTemporaryConversation && chatState.currentConversationId) {
        try {
          preparedHistory = await prepareConversationHistory({
            conversationId: chatState.currentConversationId,
            chats,
            currentUserInput: effectiveRequestText,
            additionalContext: compactionContext,
            imageCount: 0,
          })
          pendingCapacityProbe = preparedHistory.capacityProbe
          contextCapacityProbeActive = Boolean(
            preparedHistory.capacityProbe
            || preparedHistory.capacityLimitProbe
          )
        } catch (error) {
          console.error('[ConversationCompaction] Failed to prepare history:', error)
        }
      }

      // 使用 buildMessagesWithHistory 构建完整的消息数组
      // 注意：Agent 模式下，不传入 systemPrompt（Agent 会自己构建）
      // 将所有上下文（文章、RAG、关联文件、引用）作为 additionalContext
      let messages = buildMessagesWithHistory(
        chats,
        undefined, // systemPrompt - Agent 会自己构建
        context,   // additionalContext - 包含文章、RAG、关联文件、引用等
        undefined, // currentUserInput - AgentRuntime 负责且只注入一次
        {
          // Agent 自己会在 think() 里重新注入当前请求，避免重复。
          // 保留 assistant 历史；已由会话级摘要覆盖的旧回合会在构建阶段排除。
          includeAssistantMessages: true,
          includeLatestUserMessage: false,
          conversationSummary: preparedHistory?.compaction?.summary,
          coveredThroughChatId: preparedHistory?.compaction?.coveredThroughChatId,
        }
      )

      agentDebugLog('chat_messages_built', {
        userInput: effectiveRequestText,
        contextLength: context.length,
        compactionRevision: preparedHistory?.compaction?.revision || null,
        compactionSource: preparedHistory?.capacity.source || null,
        compactionWindow: preparedHistory?.capacity.contextWindow || null,
        messageCount: messages.length,
        messages: messages.map((message, index) => ({
          index,
          role: message.role,
          contentLength: message.content.length,
          preview: previewText(message.content),
        })),
      })

      try {
        await agentHandler.execute(effectiveRequestText, messages)
      } catch (error) {
        const parsedOverflow = parseContextOverflowError(error)
        const overflow =
          !parsedOverflow.detected
          && contextCapacityProbeActive
          && isUnknownProviderError(error)
            ? { detected: true }
            : parsedOverflow
        const canRetry =
          overflow.detected
          && contextOverflowRetryRef.current === 0
          && useChatStore.getState().agentState.toolCalls.length === 0
          && !chatState.isTemporaryConversation
          && Boolean(chatState.currentConversationId)

        if (!canRetry || !chatState.currentConversationId) {
          throw error
        }

        contextOverflowRetryRef.current = 1
        const previousCompactionRevision = preparedHistory?.compaction?.revision
        preparedHistory = await prepareConversationHistory({
          conversationId: chatState.currentConversationId,
          chats: useChatStore.getState().chats,
          currentUserInput: effectiveRequestText,
          additionalContext: compactionContext,
          imageCount: 0,
          force: true,
        })
        pendingCapacityProbe = preparedHistory.capacityProbe
        contextCapacityProbeActive = false
        if (
          !preparedHistory.compacted
          && preparedHistory.compaction?.revision === previousCompactionRevision
        ) {
          throw error
        }
        messages = buildMessagesWithHistory(
          useChatStore.getState().chats,
          undefined,
          context,
          undefined,
          {
            includeAssistantMessages: true,
            includeLatestUserMessage: false,
            conversationSummary: preparedHistory.compaction?.summary,
            coveredThroughChatId: preparedHistory.compaction?.coveredThroughChatId,
          }
        )
        await agentHandler.execute(effectiveRequestText, messages)
      }
    } catch (error) {
      if (deferredOverflowError) {
        await persistAgentError(deferredOverflowError)
        deferredOverflowError = undefined
      }
      console.error('Agent execution error:', error)
    } finally {
      // 清空 ref
      agentHandlerRef.current = null
    }
  }

  regenerateResponseRef.current = async (assistantChatId: number) => {
    if (activeRunRef.current || useChatStore.getState().loading) return

    const chatState = useChatStore.getState()
    const assistantIndex = chatState.chats.findIndex(chat => chat.id === assistantChatId)
    const assistantMessage = chatState.chats[assistantIndex]
    if (assistantIndex < 1 || assistantMessage?.role !== 'system') return

    const userMessage = [...chatState.chats.slice(0, assistantIndex)]
      .reverse()
      .find(chat => chat.role === 'user' && chat.type === 'chat')
    if (!userMessage) return

    let previousSelectedSkills: string[] = []
    let previousRunUsedTools = false
    if (assistantMessage.agentHistory) {
      try {
        const history = JSON.parse(assistantMessage.agentHistory) as {
          selectedSkills?: unknown
          toolCalls?: unknown
          changes?: unknown
        }
        previousSelectedSkills = Array.isArray(history.selectedSkills)
          ? history.selectedSkills.filter((skill): skill is string => typeof skill === 'string')
          : []
        previousRunUsedTools = (Array.isArray(history.toolCalls) && history.toolCalls.length > 0)
          || (Array.isArray(history.changes) && history.changes.length > 0)
      } catch {
        previousSelectedSkills = []
      }
    }

    if (
      previousRunUsedTools
      && !window.confirm('这条回复执行过工具操作。重新生成只会替换回复内容，已执行的文件或数据操作不会自动撤销，是否继续？')
    ) return

    let previousQuote: QuoteData | null = null
    if (userMessage.quoteData) {
      try {
        previousQuote = JSON.parse(userMessage.quoteData) as QuoteData
      } catch {
        previousQuote = null
      }
    }

    let previousImages: ImageAttachment[] = []
    if (userMessage.images) {
      try {
        const urls = JSON.parse(userMessage.images) as string[]
        previousImages = urls.map((url, index) => ({
          id: `regenerate-${userMessage.id}-${index}`,
          url,
          source: 'file',
        }))
      } catch {
        previousImages = []
      }
    }

    manualStopRequestedRef.current = false
    contextOverflowRetryRef.current = 0
    activeRunRef.current = true
    repeatedScriptApprovalRef.current = { signature: '', count: 0 }
    setLoading(true)
    try {
      await chatState.deleteChat(assistantChatId)
      await handleAgentMode(previousImages, userMessage, {
        requestText: userMessage.content?.trim() || t('record.chat.input.addAttachment.attachmentOnlyPrompt'),
        quoteData: previousQuote,
        selectedSkills: previousSelectedSkills,
      })
    } finally {
      activeRunRef.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    const handleRegenerate = ({ assistantChatId }: { assistantChatId: number }) => {
      void regenerateResponseRef.current(assistantChatId)
    }
    emitter.on('chat-regenerate-response', handleRegenerate)
    return () => emitter.off('chat-regenerate-response', handleRegenerate)
  }, [])

  // 对话（Agent 模式）
  async function handleSubmit() {
    if (!inputValue.trim() && attachedImages.length === 0 && fileAttachments.length === 0) return

    const submissionFingerprint = JSON.stringify({
      text: inputValue.trim(),
      images: attachedImages.map(image => image.id),
      files: fileAttachments.map(file => file.id),
    })
    const submissionTimestamp = Date.now()
    if (
      recentSubmissionRef.current?.fingerprint === submissionFingerprint
      && submissionTimestamp - recentSubmissionRef.current.timestamp < 2000
    ) return
    recentSubmissionRef.current = { fingerprint: submissionFingerprint, timestamp: submissionTimestamp }

    if (activeRunRef.current) {
      const sequence = ++steeringSequenceRef.current
      const text = requestText
      const steeringQuote = quoteData ? {
        fileName: quoteData.fileName,
        startLine: quoteData.startLine,
        endLine: quoteData.endLine,
        from: quoteData.from,
        to: quoteData.to,
        fullContent: quoteData.fullContent,
      } : undefined

      agentHandlerRef.current?.beginSteering()
      onSent?.()

      steeringChainRef.current = steeringChainRef.current.then(async () => {
        if (manualStopRequestedRef.current) return
        let additionalContext = ''
        let steeringImageAttachments: PersistedChatImageAnalysis[] | undefined
        try {
          additionalContext = await buildSteeringContext()
        } catch (error) {
          console.error('Failed to build steering context:', error)
        }
        if (attachedImages.length > 0) {
          imageAnalysisAbortControllerRef.current?.abort()
          const controller = new AbortController()
          imageAnalysisAbortControllerRef.current = controller
          const imageResult = await buildChatImageContext(attachedImages, text, {
            signal: controller.signal,
          })
          imageAnalysisAbortControllerRef.current = null
          additionalContext = [additionalContext, imageResult.context].filter(Boolean).join('\n\n')
          steeringImageAttachments = imageResult.analyses
        }
        const payload: AgentSteeringPayload = {
          sequence,
          text,
          selectedSkills: selectedSkillIds,
          additionalContext,
          currentQuote: steeringQuote,
          attachments: fileAttachments,
          imageAttachments: steeringImageAttachments,
        }
        if (agentHandlerRef.current) {
          agentHandlerRef.current.steer(payload)
        } else {
          pendingSteeringRef.current.push(payload)
        }
      })
      return
    }

    manualStopRequestedRef.current = false
    contextOverflowRetryRef.current = 0
    activeRunRef.current = true
    repeatedScriptApprovalRef.current = { signature: '', count: 0 }
    onSent?.()

    setLoading(true)
    try {
      const imageUrls = attachedImages.map(img => img.url)
      const userMessage = await insert({
        tagId: currentTagId,
        role: 'user',
        content: inputValue,
        type: 'chat',
        inserted: false,
        images: imageUrls.length > 0 ? JSON.stringify(imageUrls) : undefined,
        imageAnalyses: attachedImages.length > 0
          ? serializeChatImageAnalyses(createPendingChatImageAnalyses(attachedImages, requestText))
          : undefined,
        attachments: fileAttachments.length > 0 ? serializeChatAttachments(fileAttachments) : undefined,
        quoteData: quoteData ? JSON.stringify(quoteData) : undefined,
      })
      if (userMessage) {
        await handleAgentMode(attachedImages, userMessage)
      }
    } finally {
      activeRunRef.current = false
      setLoading(false)
    }
  }

  const handleStop = async () => {
    manualStopRequestedRef.current = true
    activeRunRef.current = false
    pendingSteeringRef.current = []
    imageAnalysisAbortControllerRef.current?.abort()
    imageAnalysisAbortControllerRef.current = null

    // 停止普通对话的流式输出
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    // 停止 Agent 执行
    if (agentHandlerRef.current) {
      agentHandlerRef.current.stop()
      // 不立即清空 ref，等待 Agent 的错误处理完成并调用 onComplete
    }

    // 重置 loading 状态
    setLoading(false)
  }

  const hasInput = Boolean(inputValue.trim() || attachedImages.length > 0 || fileAttachments.length > 0)
  const showStop = loading && !hasInput

  return <TooltipButton
    variant={dockStyle ? "ghost" : showStop ? "destructive" : "default"}
    size={dockStyle ? "icon" : "sm"}
    icon={showStop ? <Square className="fill-current" /> : <Send />}
    disabled={!showStop && (!primaryModel || !hasInput)}
    tooltipText={showStop
      ? t('record.chat.input.stop')
      : loading
        ? t('record.chat.input.steer')
        : t('record.chat.input.send')}
    onClick={showStop ? handleStop : handleSubmit}
    buttonClassName={dockStyle ? cn(
      "size-8 rounded-full border border-border/50 bg-[hsl(var(--component-active-bg))] text-foreground shadow-none hover:bg-[hsl(var(--component-active-bg))] hover:text-foreground",
      showStop && "border-destructive bg-background text-destructive hover:bg-background hover:text-destructive"
    ) : undefined}
  />
})

ChatSend.displayName = 'ChatSend';
