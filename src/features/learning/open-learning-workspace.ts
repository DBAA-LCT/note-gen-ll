import useArticleStore from '@/stores/article'
import useLearningWorkspaceStore, { type LearningWorkspaceView } from '@/stores/learning-workspace'
import { useSidebarStore } from '@/stores/sidebar'

export const LEARNING_WORKSPACE_PATH = 'learning://workspace'

export const planningViewNames: Record<LearningWorkspaceView, string> = {
  today: '今日',
  goals: '目标',
  reports: '回顾',
  periods: '回顾',
  calendar: '日程',
  focus: '专注',
  review: '复习',
}

export async function openLearningWorkspace(view: LearningWorkspaceView = 'today') {
  useLearningWorkspaceStore.getState().setActiveView(view)
  const tabName = planningViewNames[view]

  const articleStore = useArticleStore.getState()
  const existingTab = articleStore.openTabs.find((tab) => tab.path === LEARNING_WORKSPACE_PATH)

  await useSidebarStore.getState().showCenterPanel()
  await articleStore.setActiveFilePath('')

  if (existingTab) {
    if (existingTab.name !== tabName) {
      await articleStore.setOpenTabs(articleStore.openTabs.map((tab) => tab.id === existingTab.id ? { ...tab, name: tabName } : tab))
    }
    await articleStore.setActiveTabId(existingTab.id)
    return
  }

  await articleStore.addTab({
    id: `learning-${Date.now()}`,
    path: LEARNING_WORKSPACE_PATH,
    name: tabName,
    isFolder: false,
    kind: 'learning',
  })
}
