"use client"

import { ModelSelect } from "./model-select"
import { PromptSelect } from "./prompt-select"

export function ChatFooter() {
  return (
    <footer className="flex h-6 w-full items-center justify-between border-t border-border bg-background px-1 text-xs text-muted-foreground">
      <ModelSelect display="status" />
      <PromptSelect display="status" />
    </footer>
  )
}
