let aiSuggestionVisible = false
let activeAiSuggestionRequestId: string | null = null

export function setAiSuggestionShortcutVisible(visible: boolean) {
  aiSuggestionVisible = visible
}

export function isAiSuggestionShortcutVisible() {
  return aiSuggestionVisible
}

export function setActiveAiSuggestionRequestId(requestId: string | null) {
  activeAiSuggestionRequestId = requestId
}

export function getActiveAiSuggestionRequestId() {
  return activeAiSuggestionRequestId
}
