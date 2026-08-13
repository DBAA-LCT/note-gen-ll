'use client'

import type { LucideIcon } from 'lucide-react'
import { Bot, Braces, Code2, Sparkles, Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentEngineId } from '@/lib/agent-engines'

type AgentEngineVisual = {
  label: string
  shortLabel: string
  icon: LucideIcon
  markClassName: string
  activeClassName: string
}

export const AGENT_ENGINE_VISUALS: Record<AgentEngineId, AgentEngineVisual> = {
  native: {
    label: 'NoteGoal 内置',
    shortLabel: '内置',
    icon: Sparkles,
    markClassName: 'border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-400',
    activeClassName: 'after:bg-sky-500',
  },
  claude: {
    label: 'Claude Code',
    shortLabel: 'Claude',
    icon: Bot,
    markClassName: 'border-orange-500/25 bg-orange-500/10 text-orange-600 dark:text-orange-400',
    activeClassName: 'after:bg-orange-500',
  },
  codex: {
    label: 'Codex',
    shortLabel: 'Codex',
    icon: Code2,
    markClassName: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    activeClassName: 'after:bg-emerald-500',
  },
  opencode: {
    label: 'OpenCode',
    shortLabel: 'OpenCode',
    icon: Braces,
    markClassName: 'border-violet-500/25 bg-violet-500/10 text-violet-600 dark:text-violet-400',
    activeClassName: 'after:bg-violet-500',
  },
  workbuddy: {
    label: 'WorkBuddy',
    shortLabel: 'WorkBuddy',
    icon: Terminal,
    markClassName: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
    activeClassName: 'after:bg-cyan-500',
  },
}

export function AgentEngineMark({ engine, className }: { engine: AgentEngineId; className?: string }) {
  const visual = AGENT_ENGINE_VISUALS[engine]
  const Icon = visual.icon
  return (
    <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md border', visual.markClassName, className)}>
      <Icon className="size-3.5" aria-hidden="true" />
    </span>
  )
}

export function AgentEngineBadge({ engine, compact = false }: { engine: AgentEngineId; compact?: boolean }) {
  const visual = AGENT_ENGINE_VISUALS[engine]
  return (
    <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-foreground">
      <AgentEngineMark engine={engine} className="size-5 rounded-[5px]" />
      <span className={cn('truncate', compact && 'hidden lg:inline')}>{visual.shortLabel}</span>
    </span>
  )
}
