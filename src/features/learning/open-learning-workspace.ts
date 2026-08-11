import useArticleStore from '@/stores/article'
import useLearningWorkspaceStore, { type LearningWorkspaceView } from '@/stores/learning-workspace'
import { useSidebarStore } from '@/stores/sidebar'

export const LEARNING_WORKSPACE_PATH = 'learning://workspace'

export async function openLearningWorkspace(view: LearningWorkspaceView = 'today') {
  useLearningWorkspaceStore.getState().setActiveView(view)

  const articleStore = useArticleStore.getState()
  const existingTab = articleStore.openTabs.find((tab) => tab.path === LEARNING_WORKSPACE_PATH)

  await useSidebarStore.getState().showCenterPanel()
  await articleStore.setActiveFilePath('')

  if (existingTab) {
    await articleStore.setActiveTabId(existingTab.id)
    return
  }

  await articleStore.addTab({
    id: `learning-${Date.now()}`,
    path: LEARNING_WORKSPACE_PATH,
    name: '学习中心',
    isFolder: false,
    kind: 'learning',
  })
}
