'use client'

import { FileText, MessageSquareText, Search, FolderOpen } from 'lucide-react'
import useArticleStore from '@/stores/article'
import { useTranslations } from 'next-intl'
import { open } from '@tauri-apps/plugin-dialog'
import { Store } from '@tauri-apps/plugin-store'
import Image from 'next/image'
import emitter from '@/lib/emitter'
import { useEffect, useState } from 'react'
import useShortcutStore from '@/stores/shortcut'
import useSettingStore from '@/stores/setting'
import { useSidebarStore } from '@/stores/sidebar'
import { getActiveOnboardingStep, getNextOnboardingStep, type OnboardingProgress, type OnboardingStepId } from './onboarding-state'
import { createNewNoteFromEmptyState } from './empty-state-actions'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Kbd } from '@/components/ui/kbd'

interface ActionItem {
  icon: React.ReactNode
  title: string
  description: string
  shortcut?: string
  onClick: () => void
}

interface EmptyStateProps {
  onboardingProgress: OnboardingProgress
  activeOnboardingStep: OnboardingStepId | null
  visibleOnboardingStep: OnboardingStepId | null
  completedOnboardingStep: OnboardingStepId | null
  onStartOnboardingStep: (step: OnboardingStepId) => void | Promise<void>
  onContinueToNextStep: () => void | Promise<void>
  onDismissOnboarding: () => void | Promise<void>
}

export function EmptyState({
  onboardingProgress,
  activeOnboardingStep,
  visibleOnboardingStep,
  completedOnboardingStep,
  onStartOnboardingStep,
  onContinueToNextStep,
  onDismissOnboarding,
}: EmptyStateProps) {
  const { newFile } = useArticleStore()
  const { setLeftSidebarTab } = useSidebarStore()
  const t = useTranslations('article.emptyState')
  const { shortcuts } = useShortcutStore()
  const { addWorkspaceHistory } = useSettingStore()
  const [textRecordShortcut, setTextRecordShortcut] = useState('')

  const handleCreateNote = async () => {
    await createNewNoteFromEmptyState({
      setLeftSidebarTab,
      newFile,
    })
  }

  // 注册快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + N 创建笔记
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        void handleCreateNote()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [newFile, setLeftSidebarTab])

  // 读取文本记录快捷键
  useEffect(() => {
    const shortcut = shortcuts.find(s => s.key === 'quickRecordText')
    if (shortcut) {
      // 转换快捷键格式：CommandOrControl+Shift+T -> ⌘ ⇧ T
      const formatted = shortcut.value
        .replace('CommandOrControl', '⌘')
        .replace('Command', '⌘')
        .replace('Control', 'Ctrl')
        .replace('Shift', '⇧')
        .replace('Alt', '⌥')
        .replace('+', ' ')
      setTextRecordShortcut(formatted)
    }
  }, [shortcuts])

  const handleOpenWorkspace = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择工作区目录'
      })
      
      if (selected && typeof selected === 'string') {
        const store = await Store.load('store.json')
        await store.set('workspacePath', selected)
        await store.save()
        
        // 添加到历史记录
        await addWorkspaceHistory(selected)
        
        // 重新加载页面以应用新工作区
        window.location.reload()
      }
    } catch (error) {
      console.error('Failed to open workspace:', error)
    }
  }

  const handleOpenRecord = () => {
    // 触发文本记录弹窗
    emitter.emit('quickRecordTextHandler')
  }

  const handleGlobalSearch = () => {
    // 触发全局搜索弹窗 (Cmd/Ctrl + F)
    const event = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      ctrlKey: true,
      bubbles: true
    })
    window.dispatchEvent(event)
  }

  const actions: ActionItem[] = [
    {
      icon: <FileText className="w-5 h-5" />,
      title: t('actions.newNote.title'),
      description: t('actions.newNote.desc'),
      shortcut: '⌘ N',
      onClick: () => void handleCreateNote()
    },
    {
      icon: <MessageSquareText className="w-5 h-5" />,
      title: t('actions.newRecord.title'),
      description: t('actions.newRecord.desc'),
      shortcut: textRecordShortcut,
      onClick: handleOpenRecord
    },
    {
      icon: <Search className="w-5 h-5" />,
      title: t('actions.globalSearch.title'),
      description: t('actions.globalSearch.desc'),
      shortcut: '⌘ F',
      onClick: handleGlobalSearch
    },
    {
      icon: <FolderOpen className="w-5 h-5" />,
      title: t('actions.openWorkspace.title'),
      description: t('actions.openWorkspace.desc'),
      onClick: handleOpenWorkspace
    }
  ]

  const onboardingSteps: Array<{ id: OnboardingStepId; title: string; description: string }> = [
    {
      id: 'create-record',
      title: t('onboarding.steps.createRecord.title'),
      description: t('onboarding.steps.createRecord.desc'),
    },
    {
      id: 'organize-note',
      title: t('onboarding.steps.organizeNote.title'),
      description: t('onboarding.steps.organizeNote.desc'),
    },
    {
      id: 'ai-polish',
      title: t('onboarding.steps.aiPolish.title'),
      description: t('onboarding.steps.aiPolish.desc'),
    },
  ]
  const completedStep = onboardingSteps.find((step) => step.id === completedOnboardingStep) || null
  const nextOnboardingStepId = getNextOnboardingStep(onboardingProgress, completedOnboardingStep)
  const hasPendingNextStep = getActiveOnboardingStep(onboardingProgress) !== null
  const currentOnboardingStep = onboardingSteps.find((step) => step.id === activeOnboardingStep)
    || onboardingSteps.find((step) => step.id === nextOnboardingStepId)
    || null
  const currentOnboardingIndex = currentOnboardingStep
    ? onboardingSteps.findIndex((step) => step.id === currentOnboardingStep.id)
    : -1
  const completedOnboardingIndex = completedStep
    ? onboardingSteps.findIndex((step) => step.id === completedStep.id)
    : -1
  const showCompletedCard = Boolean(completedStep && hasPendingNextStep)
  const showOnboardingCard = !onboardingProgress.dismissed && (showCompletedCard || Boolean(currentOnboardingStep))

  return (
    <Empty className="h-full rounded-none bg-background p-8">
      <div className="flex w-full max-w-2xl flex-col gap-8 text-left text-pretty">
        {/* Header */}
        <EmptyHeader className="mx-auto gap-3 text-center text-balance">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Image 
              src="/app-icon.png" 
              alt="NoteGen" 
              width={60}
              height={60}
              className="w-10 h-10 dark:invert"
            />
            <h1 className="text-4xl font-bold tracking-tight">
              NoteGen
            </h1>
          </div>
          <EmptyTitle className="text-xl">
            {t('title')}
          </EmptyTitle>
          <EmptyDescription>
            {t('subtitle')}
          </EmptyDescription>
        </EmptyHeader>

        {showOnboardingCard && (
          <div className="rounded-2xl border bg-card/80 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-semibold">{t('onboarding.title')}</h3>
                <p className="text-sm text-muted-foreground">{t('onboarding.subtitle')}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => void onDismissOnboarding()}
                className="shrink-0 text-muted-foreground"
              >
                {t('onboarding.dismiss')}
              </Button>
            </div>

            {showCompletedCard && completedStep ? (
              <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t('onboarding.stepCompletedLabel', { current: completedOnboardingIndex + 1, total: onboardingSteps.length })}
                    </p>
                    <h4 className="text-sm font-medium">
                      {t(`onboarding.completedStates.${completedStep.id}.title`)}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {t(`onboarding.completedStates.${completedStep.id}.desc`)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    onClick={() => void onContinueToNextStep()}
                    className="shrink-0"
                  >
                    {t('onboarding.continue')}
                  </Button>
                </div>
              </div>
            ) : currentOnboardingStep ? (
              <div className="mt-4 rounded-xl border border-primary/60 bg-primary/5 p-4 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t('onboarding.stepLabel', { current: currentOnboardingIndex + 1, total: onboardingSteps.length })}
                    </p>
                    <h4 className="text-sm font-medium">{currentOnboardingStep.title}</h4>
                    <p className="text-xs text-muted-foreground">{currentOnboardingStep.description}</p>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    onClick={() => void onStartOnboardingStep(currentOnboardingStep.id)}
                    className="shrink-0"
                  >
                    {visibleOnboardingStep === currentOnboardingStep.id ? t('onboarding.viewHint') : t('onboarding.start')}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Actions Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {actions.map((action, index) => (
            <Button
              type="button"
              variant="outline"
              key={index}
              onClick={action.onClick}
              className="group h-auto items-start justify-start gap-4 whitespace-normal p-4 text-left"
            >
              <div className="flex-shrink-0 mt-1 text-muted-foreground group-hover:text-primary transition-colors">
                {action.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium text-sm">
                    {action.title}
                  </h3>
                  {action.shortcut && (
                    <Kbd className="hidden sm:inline-flex">
                      {action.shortcut}
                    </Kbd>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {action.description}
                </p>
              </div>
            </Button>
          ))}
        </div>

        {/* Tips */}
        <div className="flex flex-col gap-2 pt-4 text-center">
          <p className="text-xs text-muted-foreground">
            查看使用文档：
            <a 
              href="https://notegen.top/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline ml-1"
            >
              https://notegen.top/
            </a>
          </p>
        </div>
      </div>
    </Empty>
  )
}
