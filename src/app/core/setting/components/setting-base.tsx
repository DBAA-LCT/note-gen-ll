'use client'

import { createContext, useContext } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'

const MobileSettingLayoutContext = createContext(false)

export function SettingLayoutProvider({
  mobile,
  children,
}: {
  mobile: boolean
  children: React.ReactNode
}) {
  return (
    <MobileSettingLayoutContext.Provider value={mobile}>
      {children}
    </MobileSettingLayoutContext.Provider>
  )
}

export function SettingType(
  {id, title, icon, desc, children}:
  { id: string, title: string, icon?: React.ReactNode, desc?: string, children?: React.ReactNode}
) {
  const mobile = useContext(MobileSettingLayoutContext)
  const contentWidth = id === 'sync' ? 'max-w-6xl' : 'max-w-4xl'

  if (mobile) {
    return (
      <div id={id} data-setting-page className="flex min-w-0 flex-col gap-6">
        {desc && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {desc}
          </p>
        )}
        <div data-setting-sections className="flex min-w-0 flex-col gap-5">{children}</div>
      </div>
    )
  }

  return <div id={id} className="flex h-full min-h-0 flex-col">
    <header className="shrink-0 px-8 pt-8 pb-6 pr-10">
      <div className={`mx-auto flex w-full ${contentWidth} flex-col gap-1.5`}>
        <h2 className="flex w-full items-center gap-2 text-xl font-semibold tracking-tight">
          {icon && <span className="text-muted-foreground">{icon}</span>}
          {title}
        </h2>
        {desc && <p className="max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{desc}</p>}
      </div>
    </header>
    <ScrollArea data-setting-scroll className="min-h-0 flex-1">
      <div className="px-8 pt-2 pb-8 pr-10">
        <div className={`mx-auto flex w-full ${contentWidth} flex-col gap-6`}>
          {children}
        </div>
      </div>
    </ScrollArea>
  </div>
}

export function SettingSection({
  title,
  desc,
  actions,
  children,
}: {
  title: string
  desc?: string
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  const mobile = useContext(MobileSettingLayoutContext)

  return (
    <section
      data-mobile-setting-section={mobile || undefined}
      className="flex min-w-0 flex-col gap-3"
    >
      <header data-setting-section-header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold">{title}</h3>
          {desc ? <p className="text-sm text-muted-foreground">{desc}</p> : null}
        </div>
        {actions ? <div data-setting-section-actions className="shrink-0">{actions}</div> : null}
      </header>
      {children ?? null}
    </section>
  )
}
