'use client'
import { ChatHeader } from './chat-header'
import { ChatInput } from "./chat-input";
import ChatContent from "./chat-content";
import { ClipboardListener } from "./clipboard-listener";
import { AgentWorkspaceTabs } from './agent-workspace-tabs'

export default function Chat() {
  return <div id="record-chat" className="flex-col flex-1 flex relative overflow-x-hidden items-center h-full overflow-hidden">
    <AgentWorkspaceTabs />
    <ChatHeader />
    <ChatContent />
    <ClipboardListener />
    <ChatInput />
  </div>
}
