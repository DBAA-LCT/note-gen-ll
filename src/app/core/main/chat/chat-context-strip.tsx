"use client"

import {
  FileText,
  FolderOpen,
  Package,
  TextSelect,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { isLinkedFolder, type LinkedResource } from "@/lib/files"
import type { PendingQuote } from "@/stores/chat"
import type { SkillMetadata } from "@/lib/skills/types"
import type { MarkdownFile } from "@/lib/files"
import type { Mark } from "@/db/marks"
import {
  getMarkTypeIconClasses,
  MARK_TYPE_ICONS,
} from "@/app/core/main/mark/mark-type-meta"

export interface MentionedRecord extends PendingQuote {
  markType: Mark["type"]
}

export type MentionedContext =
  | { kind: "file"; file: MarkdownFile }
  | { kind: "record"; record: MentionedRecord }

export function getMentionedContextKey(context: MentionedContext) {
  if (context.kind === "file") return `file:${context.file.path}`
  return `record:${context.record.articlePath}`
}

interface ChatContextStripProps {
  linkedResource: LinkedResource | null
  activeTabContext: MentionedContext | null
  quoteData: PendingQuote | null
  selectedSkills: SkillMetadata[]
  mentionedContexts: MentionedContext[]
  onRemoveLinkedResource: () => void
  onRemoveActiveTabContext: () => void
  onRemoveQuote: () => void
  onRemoveSkill: (skillId: string) => void
  onRemoveMentionedContext: (key: string) => void
}

function ContextBadge({
  icon,
  label,
  onRemove,
}: {
  icon: React.ReactNode
  label: string
  onRemove: () => void
}) {
  return (
    <Badge
      variant="secondary"
      className="h-7 max-w-40 shrink-0 gap-1 rounded-lg pl-2 pr-0.5 font-normal"
      title={label}
    >
      <span
        className="flex size-3.5 shrink-0 items-center justify-center self-center [&>svg]:size-3.5!"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="truncate leading-none">{label}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="shrink-0"
        onClick={onRemove}
        aria-label={label}
      >
        <X />
      </Button>
    </Badge>
  )
}

function getQuoteLabel(quote: PendingQuote) {
  const selectedText = quote.quote.replace(/\s+/g, " ").trim()

  if (quote.startLine <= 0 || quote.endLine < quote.startLine) {
    return selectedText || quote.fileName
  }

  const selectedLines = quote.startLine === quote.endLine
    ? `L${quote.startLine}`
    : `L${quote.startLine}–${quote.endLine}`

  return selectedText ? `${selectedLines} · ${selectedText}` : selectedLines
}

function MentionedContextBadge({
  context,
  onRemove,
}: {
  context: MentionedContext
  onRemove: () => void
}) {
  if (context.kind === "file") {
    return <ContextBadge icon={<FileText />} label={context.file.name} onRemove={onRemove} />
  }
  if (context.kind === "record") {
    const RecordIcon = MARK_TYPE_ICONS[context.record.markType]
    return (
      <ContextBadge
        icon={<RecordIcon className={getMarkTypeIconClasses(context.record.markType)} />}
        label={context.record.fileName}
        onRemove={onRemove}
      />
    )
  }
}

export function ChatContextStrip({
  linkedResource,
  activeTabContext,
  quoteData,
  selectedSkills,
  mentionedContexts,
  onRemoveLinkedResource,
  onRemoveActiveTabContext,
  onRemoveQuote,
  onRemoveSkill,
  onRemoveMentionedContext,
}: ChatContextStripProps) {
  if (
    !linkedResource
    && !activeTabContext
    && !quoteData
    && selectedSkills.length === 0
    && mentionedContexts.length === 0
  ) return null

  return (
    <div className="flex w-full max-w-full flex-wrap gap-1 px-1 pt-1">
      {linkedResource ? (
        <ContextBadge
          icon={isLinkedFolder(linkedResource) ? <FolderOpen /> : <FileText />}
          label={linkedResource.name}
          onRemove={onRemoveLinkedResource}
        />
      ) : null}
      {activeTabContext ? (
        <MentionedContextBadge
          context={activeTabContext}
          onRemove={onRemoveActiveTabContext}
        />
      ) : null}
      {quoteData ? (
        <ContextBadge
          icon={<TextSelect />}
          label={getQuoteLabel(quoteData)}
          onRemove={onRemoveQuote}
        />
      ) : null}
      {mentionedContexts.map(context => {
        const key = getMentionedContextKey(context)
        return (
          <MentionedContextBadge
            key={key}
            context={context}
            onRemove={() => onRemoveMentionedContext(key)}
          />
        )
      })}
      {selectedSkills.map(skill => (
        <ContextBadge
          key={skill.id}
          icon={<Package />}
          label={skill.name}
          onRemove={() => onRemoveSkill(skill.id)}
        />
      ))}
    </div>
  )
}
