'use client'

import { ChartNoAxesColumnIncreasing } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import useSettingStore from '@/stores/setting'

export default function ShowEditorStats() {
  const t = useTranslations('settings.editor.stats')
  const { showEditorStats, setShowEditorStats } = useSettingStore()

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <ChartNoAxesColumnIncreasing />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{t('title')}</ItemTitle>
        <ItemDescription>{t('desc')}</ItemDescription>
      </ItemContent>
      <ItemActions className="mobile-setting-inline-action">
        <Switch
          checked={showEditorStats}
          aria-label={t('title')}
          onCheckedChange={(show) => void setShowEditorStats(show)}
        />
      </ItemActions>
    </Item>
  )
}
