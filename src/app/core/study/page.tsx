'use client'

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { openLearningWorkspace } from '@/features/learning/open-learning-workspace'
import { useSidebarStore } from '@/stores/sidebar'

function StudyPage() {
  const router = useRouter()
  const setLeftSidebarTab = useSidebarStore(state => state.setLeftSidebarTab)

  useEffect(() => {
    void setLeftSidebarTab('learning')
    void openLearningWorkspace('today')
    router.replace('/core/main')
  }, [router, setLeftSidebarTab])

  return null
}

export default dynamic(() => Promise.resolve(StudyPage), { ssr: false })
