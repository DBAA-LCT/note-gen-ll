import { Chat } from "@/db/chats"
import useChatStore from "@/stores/chat"
import { RefreshCw, XIcon } from "lucide-react"
import { clear, hasText, readText } from "tauri-plugin-clipboard-api"
import { useState } from "react"
import { MessageInfo } from "./message-info"
import { CondensedIndicator } from "./condensed-indicator"
import { TranslateControl } from "./translate-control"
import { CopyControl } from "./copy-control"
import { ReadAloudControl } from "./read-aloud-control"
import { TooltipButton } from "@/components/tooltip-button"
import { useTranslations } from 'next-intl';
import emitter from '@/lib/emitter'

export default function MessageControl({chat, children, canRegenerate = false}: {chat: Chat, children: React.ReactNode, canRegenerate?: boolean}) {
  const { deleteChat } = useChatStore()
  const [translatedContent, setTranslatedContent] = useState<string>('')
  const t = useTranslations('common')
  
  async function deleteHandler() {
    if (chat.type === "clipboard" && !chat.image) {
      const hasTextRes = await hasText()
      if (hasTextRes) {
        try {
          const text = await readText()
          if (text === chat.content) {
            await clear()
          }
        } catch {}
      }
    }
    deleteChat(chat.id)
  }

  return (
    <>
      <div className='mt-2 flex flex-wrap items-center justify-between gap-1'>

        <div className="flex min-w-0 items-center gap-1">
          <MessageInfo chat={chat} />
          <CondensedIndicator chat={chat} />
        </div>

        <div className='ml-auto flex items-center'>
          {children || null}

          <CopyControl
            chat={chat}
            translatedContent={translatedContent}
          />

          <TranslateControl
            chat={chat}
            onTranslatedContent={setTranslatedContent}
          />

          <ReadAloudControl
            chat={chat}
            translatedContent={translatedContent}
          />

          {canRegenerate ? (
            <TooltipButton
              icon={<RefreshCw className='size-4' />}
              tooltipText="重新生成回复"
              variant="ghost"
              size="icon"
              onClick={() => emitter.emit('chat-regenerate-response', { assistantChatId: chat.id })}
            />
          ) : null}

          <TooltipButton icon={<XIcon className='size-4' />} tooltipText={t('delete')} variant={"ghost"} size={"icon"} onClick={deleteHandler}/>
        </div>
      </div>

      {/* 显示翻译结果 */}
      {translatedContent && (
        <div className="mt-2 pt-2 border-t border-border">
          <div className="whitespace-pre-wrap">{translatedContent}</div>
        </div>
      )}
    </>
  )
}
