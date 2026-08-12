import useArticleStore from '@/stores/article'
import { useSidebarStore } from '@/stores/sidebar'

export const GLOBAL_SCHEDULE_PATH = 'schedule://workspace'

export async function openGlobalSchedule() {
  const articleStore = useArticleStore.getState()
  const existingTab = articleStore.openTabs.find((tab) => tab.path === GLOBAL_SCHEDULE_PATH)

  await useSidebarStore.getState().showCenterPanel()
  await articleStore.setActiveFilePath('')

  if (existingTab) {
    await articleStore.setActiveTabId(existingTab.id)
    return
  }

  await articleStore.addTab({
    id: `schedule-${Date.now()}`,
    path: GLOBAL_SCHEDULE_PATH,
    name: '日程',
    isFolder: false,
    kind: 'schedule',
  })
}
