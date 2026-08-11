'use client'

import { Editor } from '@tiptap/react'
import {
  TableIcon,
  Columns,
  Rows,
  Trash2,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group'

interface FloatingTableMenuProps {
  editor: Editor
}

export function FloatingTableMenu({ editor }: FloatingTableMenuProps) {
  const [show, setShow] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const menuRef = useRef<HTMLDivElement>(null)

  // Calculate menu position based on table selection
  const updatePosition = useCallback(() => {
    const { from } = editor.state.selection

    // Check if we're inside a table using TipTap's isActive method
    const isInsideTable = editor.isActive('table')

    if (!isInsideTable) {
      setShow(false)
      return
    }

    // Get editor bounds and scroll container
    const editorElement = document.querySelector('.ProseMirror')
    const scrollContainer = editorElement?.parentElement
    if (!editorElement || !scrollContainer) return

    const containerBounds = scrollContainer.getBoundingClientRect()

    // Get the coordinates of the selection
    const coords = editor.view.coordsAtPos(from)

    // 转换为滚动容器内的相对坐标
    const relativeTop = coords.bottom - containerBounds.top + scrollContainer.scrollTop + 10
    const relativeLeft = coords.left - containerBounds.left + scrollContainer.scrollLeft

    // 边界检测：left 在 [0, 容器宽度 - 菜单宽度] 范围内
    const currentMenuWidth = menuRef.current?.offsetWidth || 200
    const maxLeft = Math.max(0, containerBounds.width - currentMenuWidth)
    const left = Math.min(relativeLeft, maxLeft)

    setPosition({ top: relativeTop, left })
    setShow(true)
  }, [editor])

  // Update position on selection change
  useEffect(() => {
    const updateHandler = () => updatePosition()

    editor.on('selectionUpdate', updateHandler)
    editor.on('transaction', updateHandler)

    return () => {
      editor.off('selectionUpdate', updateHandler)
      editor.off('transaction', updateHandler)
    }
  }, [editor, updatePosition])

  // Hide menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShow(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Update position on scroll
  useEffect(() => {
    const scrollContainer = document.querySelector('.ProseMirror')?.parentElement
    if (!scrollContainer) return

    const handleScroll = () => {
      if (show) {
        updatePosition()
      }
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', handleScroll)
  }, [show, updatePosition])

  const canInsertTable = editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true })

  const insertTable = useCallback(() => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    setShow(false)
  }, [editor])

  const addColumnBefore = useCallback(() => {
    editor.chain().focus().addColumnBefore().run()
  }, [editor])

  const addColumnAfter = useCallback(() => {
    editor.chain().focus().addColumnAfter().run()
  }, [editor])

  const addRowBefore = useCallback(() => {
    editor.chain().focus().addRowBefore().run()
  }, [editor])

  const addRowAfter = useCallback(() => {
    editor.chain().focus().addRowAfter().run()
  }, [editor])

  const deleteColumn = useCallback(() => {
    editor.chain().focus().deleteColumn().run()
  }, [editor])

  const deleteRow = useCallback(() => {
    editor.chain().focus().deleteRow().run()
  }, [editor])

  const deleteTable = useCallback(() => {
    editor.chain().focus().deleteTable().run()
  }, [editor])

  const setColumnAlignmentLeft = useCallback(() => {
    editor.chain().focus().setCellAttribute('align', 'left').run()
  }, [editor])

  const setColumnAlignmentCenter = useCallback(() => {
    editor.chain().focus().setCellAttribute('align', 'center').run()
  }, [editor])

  const setColumnAlignmentRight = useCallback(() => {
    editor.chain().focus().setCellAttribute('align', 'right').run()
  }, [editor])

  const isTableActive = editor.isActive('table')

  if (!show) return null

  return (
    <div
      ref={menuRef}
      className="absolute z-50 transition-[top,left]"
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      {/* Table toolbar */}
      <ButtonGroup className="rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
        {/* Insert table button (when no table selected) */}
        {!isTableActive && (
          <Button type="button" variant="ghost" size="icon-sm"
            onClick={insertTable}
            disabled={!canInsertTable}
            title="插入表格"
          >
            <TableIcon />
          </Button>
        )}

        {/* Table operations (when table is active) */}
        {isTableActive && (
          <>
            {/* Add row/column */}
            <Button type="button" variant="ghost" size="icon-sm"
              onClick={addRowBefore}
              title="在上方插入行"
            >
              <Rows />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm"
              onClick={addRowAfter}
              title="在下方插入行"
            >
              <Rows className="rotate-180" />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm"
              onClick={addColumnBefore}
              title="在左侧插入列"
            >
              <Columns />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm"
              onClick={addColumnAfter}
              title="在右侧插入列"
            >
              <Columns className="rotate-180" />
            </Button>

            <ButtonGroupSeparator />

            {/* Alignment */}
            <Button type="button" variant="ghost" size="icon-sm"
              onClick={setColumnAlignmentLeft}
              title="左对齐"
            >
              <AlignLeft />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm"
              onClick={setColumnAlignmentCenter}
              title="居中对齐"
            >
              <AlignCenter />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm"
              onClick={setColumnAlignmentRight}
              title="右对齐"
            >
              <AlignRight />
            </Button>

            <ButtonGroupSeparator />

            {/* Delete */}
            <Button type="button" variant="destructive" size="icon-sm"
              onClick={deleteColumn}
              title="删除列"
            >
              <Trash2 />
            </Button>
            <Button type="button" variant="destructive" size="icon-sm"
              onClick={deleteRow}
              title="删除行"
            >
              <Rows />
            </Button>
            <Button type="button" variant="destructive" size="icon-sm"
              onClick={deleteTable}
              title="删除表格"
            >
              <Trash2 />
            </Button>
          </>
        )}
      </ButtonGroup>
    </div>
  )
}

export default FloatingTableMenu
