"use client"

import { useState } from 'react'
import { FileIcon, FolderOpen, ImageIcon, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  Item,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface AttachmentAddMenuProps {
  mobile: boolean
  disabled?: boolean
  onSelectImages: () => void
  onSelectFiles: () => void
  onSelectFolders: () => void
}

const ACTIONS = [
  { id: 'image', icon: ImageIcon },
  { id: 'file', icon: FileIcon },
  { id: 'folder', icon: FolderOpen },
] as const

export function AttachmentAddMenu({
  mobile,
  disabled,
  onSelectImages,
  onSelectFiles,
  onSelectFolders,
}: AttachmentAddMenuProps) {
  const [open, setOpen] = useState(false)
  const t = useTranslations('record.chat.input.addAttachment')

  const selectAction = (id: typeof ACTIONS[number]['id']) => {
    setOpen(false)
    if (id === 'image') onSelectImages()
    if (id === 'file') onSelectFiles()
    if (id === 'folder') onSelectFolders()
  }

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 text-muted-foreground"
      disabled={disabled}
      aria-label={t('title')}
      title={t('title')}
    >
      <Plus data-icon="inline-start" />
    </Button>
  )

  const items = (
    <ItemGroup className="gap-1">
      {ACTIONS.map(({ id, icon: Icon }) => (
        <Item key={id} asChild size="sm" className="cursor-pointer hover:bg-muted">
          <button type="button" onClick={() => selectAction(id)}>
            <ItemMedia variant="icon"><Icon /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t(`${id}.title`)}</ItemTitle>
            </ItemContent>
          </button>
        </Item>
      ))}
    </ItemGroup>
  )

  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent>
          <DrawerTitle className="sr-only">{t('title')}</DrawerTitle>
          <div className="px-3 pb-5">
            <ItemGroup className="gap-1">
              {ACTIONS.map(({ id, icon: Icon }) => (
                <DrawerClose asChild key={id}>
                  <Item asChild size="sm" className="cursor-pointer hover:bg-muted">
                    <button type="button" onClick={() => selectAction(id)}>
                      <ItemMedia variant="icon"><Icon /></ItemMedia>
                      <ItemContent>
                        <ItemTitle>{t(`${id}.title`)}</ItemTitle>
                      </ItemContent>
                    </button>
                  </Item>
                </DrawerClose>
              ))}
            </ItemGroup>
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-48">
        {items}
      </PopoverContent>
    </Popover>
  )
}
