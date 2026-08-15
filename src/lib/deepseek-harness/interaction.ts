import useChatStore from '@/stores/chat'

export interface HarnessQuestion {
  id: string
  question: string
  detail?: string
  header?: string
  options?: Array<{ label: string; description?: string }>
  multiSelect?: boolean
  intent?: { kind: 'plan-review'; approve: string }
}

export interface HarnessQuestionAnswer {
  id: string
  selected: string[]
  custom?: string
}

let active: {
  token: string
  resolve: (value: { answers: HarnessQuestionAnswer[] }) => void
  reject: (reason: Error) => void
} | undefined

export function requestHarnessQuestions(questions: HarnessQuestion[]) {
  if (active) active.reject(new Error('新的 Harness 问题替代了尚未回答的问题。'))
  const token = crypto.randomUUID()
  useChatStore.getState().setAgentState({ pendingHarnessQuestions: { token, questions } })
  return new Promise<{ answers: HarnessQuestionAnswer[] }>((resolve, reject) => {
    active = { token, resolve, reject }
  })
}

export function answerHarnessQuestions(token: string, answers: HarnessQuestionAnswer[]) {
  if (active?.token !== token) return false
  const pending = active
  active = undefined
  useChatStore.getState().setAgentState({ pendingHarnessQuestions: undefined })
  pending.resolve({ answers })
  return true
}

export function cancelHarnessQuestions(token?: string) {
  if (!active || (token !== undefined && active.token !== token)) return false
  const pending = active
  active = undefined
  useChatStore.getState().setAgentState({ pendingHarnessQuestions: undefined })
  pending.reject(new Error('用户取消了 Harness 问题。'))
  return true
}
