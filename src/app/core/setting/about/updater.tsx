'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'
import useSettingStore from '@/stores/setting'
import { Badge } from '@/components/ui/badge'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function Updater() {
  const { version } = useSettingStore()
  const t = useTranslations('settings.about')

  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-5">
        <div className="flex min-w-0 items-center gap-3">
          <Image src="/app-icon.png" alt="NoteGoal logo" className="size-14 shrink-0" width={56} height={56} />
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-xl font-semibold leading-none">NoteGoal</CardTitle>
              <Badge variant="outline">v{version}</Badge>
            </div>
            <CardDescription className="text-sm">
              {t('desc')}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
    </Card>
  )
}
