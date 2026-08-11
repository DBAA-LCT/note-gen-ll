'use client'

import { MobileEditor } from './mobile-editor'
import { WritingHeader } from './custom-header'
import useArticleStore from '@/stores/article'
import { useEffect } from 'react'

export function WritingScreen() {
  const { initCollapsibleList } = useArticleStore()

  useEffect(() => {
    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLElement
      && activeElement.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
    ) {
      activeElement.blur()
    }
    initCollapsibleList()
  }, [initCollapsibleList])

  return (
    <div id="mobile-writing" className='w-full h-full flex flex-col'>
      <WritingHeader />
      <div className='flex-1 overflow-hidden'>
        <MobileEditor />
      </div>
    </div>
  )
}
