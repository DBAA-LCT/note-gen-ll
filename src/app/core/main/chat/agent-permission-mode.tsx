"use client"

import { Eye, ShieldCheck, ShieldQuestion } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { ResponsiveActionMenu } from "@/components/responsive-action-menu"
import type { AgentPermissionMode } from "@/lib/agent/types"
import useChatStore from "@/stores/chat"
import useSettingStore from "@/stores/setting"

const MODE_ICONS = {
  "read-only": Eye,
  ask: ShieldQuestion,
  "auto-edit": ShieldCheck,
} satisfies Record<AgentPermissionMode, typeof Eye>

export function AgentPermissionModeSelect() {
  const t = useTranslations("record.chat.input.agent.permissionMode")
  const { agentPermissionMode, setAgentPermissionMode } = useSettingStore()
  const loading = useChatStore((state) => state.loading)
  const Icon = MODE_ICONS[agentPermissionMode]

  const handleChange = (value: string) => {
    if (value === "read-only" || value === "ask" || value === "auto-edit") {
      void setAgentPermissionMode(value)
    }
  }

  return (
    <ResponsiveActionMenu
      title={t("label")}
      desktopClassName="w-64"
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loading}
          className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
          aria-label={t("label")}
        >
          <Icon className="size-4" />
          <span className="hidden md:inline">{t(`modes.${agentPermissionMode}.title`)}</span>
        </Button>
      }
      items={(["read-only", "ask", "auto-edit"] as const).map(mode => {
        const ModeIcon = MODE_ICONS[mode]
        return {
          key: mode,
          icon: <ModeIcon />,
          label: (
            <span className="flex min-w-0 flex-col items-start">
              <span>{t(`modes.${mode}.title`)}</span>
              <span className="text-xs text-muted-foreground">{t(`modes.${mode}.description`)}</span>
            </span>
          ),
          selected: mode === agentPermissionMode,
          onSelect: () => handleChange(mode),
        }
      })}
    />
  )
}
