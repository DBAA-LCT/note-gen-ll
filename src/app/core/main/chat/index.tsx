'use client'
import { ChatHeader } from './chat-header'
import { ChatInput } from "./chat-input";
import ChatContent from "./chat-content";
import { ClipboardListener } from "./clipboard-listener";
import { ChatFooter } from './chat-footer'

export default function Chat() {
  return <div id="record-chat" className="flex-col flex-1 flex relative overflow-x-hidden items-center h-full overflow-hidden">
    <ChatHeader />
    <ChatContent />
    <ClipboardListener />
    <ChatInput />
    <ChatFooter />
  </div>
}
