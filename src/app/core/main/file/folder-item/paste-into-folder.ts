import { copyFile, mkdir, readDir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'

import { toast } from '@/hooks/use-toast'
import { generateCopyFilename, generateCopyFoldername } from '@/lib/default-filename'
import {
  rewriteMarkdownMediaPaths,
  rewriteWorkspaceMarkdownMediaPaths,
  type WorkspacePathMove,
} from '@/lib/markdown-media-path'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import type { ClipboardItem } from '@/stores/clipboard'

import { getPasteTargetDirectory } from './paste-target'

type ClipboardOperation = 'copy' | 'cut' | 'none'

interface PasteIntoFolderOptions {
  clipboardItem: ClipboardItem | null
  clipboardItems: ClipboardItem[]
  clipboardOperation: ClipboardOperation
  folderPath: string
  emptyToastTitle: string
  pastedToastTitle: string
  pasteFailedToastTitle: string
  loadFileTree: () => void | Promise<void>
  setClipboardItem: (item: ClipboardItem | null, operation: ClipboardOperation) => void
  cleanTabsByDeletedFile?: (path: string) => void | Promise<void>
  cleanTabsByDeletedFolder?: (path: string) => void | Promise<void>
}

async function copyWorkspaceFile(
  sourcePath: string,
  targetPath: string,
  pathMoves: WorkspacePathMove[],
): Promise<void> {
  const sourceOptions = await getFilePathOptions(sourcePath)
  const targetOptions = await getFilePathOptions(targetPath)

  if (sourceOptions.baseDir || targetOptions.baseDir) {
    await copyFile(sourceOptions.path, targetOptions.path, {
      fromPathBaseDir: sourceOptions.baseDir,
      toPathBaseDir: targetOptions.baseDir,
    })
  } else {
    await copyFile(sourceOptions.path, targetOptions.path)
  }

  if (!/\.(?:md|markdown)$/i.test(sourcePath)) return

  const content = sourceOptions.baseDir
    ? await readTextFile(sourceOptions.path, { baseDir: sourceOptions.baseDir })
    : await readTextFile(sourceOptions.path)
  const rewrittenContent = rewriteMarkdownMediaPaths(content, sourcePath, targetPath, pathMoves)
  if (rewrittenContent === content) return

  if (targetOptions.baseDir) {
    await writeTextFile(targetOptions.path, rewrittenContent, { baseDir: targetOptions.baseDir })
  } else {
    await writeTextFile(targetOptions.path, rewrittenContent)
  }
}

async function copyWorkspaceDirectory(
  sourcePath: string,
  targetPath: string,
  rootTargetName: string,
  isPasteIntoSelf: boolean,
  pathMoves: WorkspacePathMove[],
): Promise<void> {
  const sourceOptions = await getFilePathOptions(sourcePath)
  const entries = sourceOptions.baseDir
    ? await readDir(sourceOptions.path, { baseDir: sourceOptions.baseDir })
    : await readDir(sourceOptions.path)

  for (const entry of entries) {
    if (isPasteIntoSelf && sourcePath === pathMoves[0]?.sourcePath && entry.name === rootTargetName) {
      continue
    }

    const sourceEntryPath = `${sourcePath}/${entry.name}`
    const targetEntryPath = `${targetPath}/${entry.name}`
    if (entry.isDirectory) {
      const targetOptions = await getFilePathOptions(targetEntryPath)
      if (targetOptions.baseDir) {
        await mkdir(targetOptions.path, { baseDir: targetOptions.baseDir })
      } else {
        await mkdir(targetOptions.path)
      }
      await copyWorkspaceDirectory(
        sourceEntryPath,
        targetEntryPath,
        rootTargetName,
        isPasteIntoSelf,
        pathMoves,
      )
    } else if (entry.isFile) {
      await copyWorkspaceFile(sourceEntryPath, targetEntryPath, pathMoves)
    }
  }
}

export async function pasteIntoFolder({
  clipboardItem,
  clipboardItems,
  clipboardOperation,
  folderPath,
  emptyToastTitle,
  pastedToastTitle,
  pasteFailedToastTitle,
  loadFileTree,
  setClipboardItem,
  cleanTabsByDeletedFile,
  cleanTabsByDeletedFolder,
}: PasteIntoFolderOptions): Promise<boolean> {
  const itemsToPaste = clipboardItems.length > 0
    ? clipboardItems
    : clipboardItem ? [clipboardItem] : []

  if (itemsToPaste.length === 0) {
    toast({ title: emptyToastTitle, variant: 'destructive' })
    return false
  }

  try {
    const workspace = await getWorkspacePath()
    const targetDir = getPasteTargetDirectory(folderPath)
    const pathMoves: WorkspacePathMove[] = []

    for (const item of itemsToPaste) {
      if (item.isDirectory && targetDir.startsWith(`${item.path}/`)) {
        toast({ title: pasteFailedToastTitle, variant: 'destructive' })
        return false
      }

      const targetName = item.isDirectory
        ? await generateCopyFoldername(targetDir, item.name)
        : await generateCopyFilename(targetDir, item.name)
      const targetPath = targetDir ? `${targetDir}/${targetName}` : targetName
      const pathMove = { sourcePath: item.path, targetPath }
      pathMoves.push(pathMove)

      if (item.isDirectory) {
        const targetOptions = await getFilePathOptions(targetPath)
        if (targetOptions.baseDir) {
          await mkdir(targetOptions.path, { baseDir: targetOptions.baseDir })
        } else {
          await mkdir(targetOptions.path)
        }
        await copyWorkspaceDirectory(
          item.path,
          targetPath,
          targetName,
          targetDir === item.path,
          [pathMove],
        )
      } else {
        await copyWorkspaceFile(item.path, targetPath, [pathMove])
      }
    }

    if (clipboardOperation === 'cut') {
      await rewriteWorkspaceMarkdownMediaPaths(pathMoves)

      for (const item of itemsToPaste) {
        const sourcePathOptions = await getFilePathOptions(item.path)
        if (workspace.isCustom) {
          await remove(sourcePathOptions.path, { recursive: true })
        } else {
          await remove(sourcePathOptions.path, { baseDir: sourcePathOptions.baseDir, recursive: true })
        }

        if (item.isDirectory) {
          await cleanTabsByDeletedFolder?.(item.path)
        } else {
          await cleanTabsByDeletedFile?.(item.path)
        }
      }
      setClipboardItem(null, 'none')
    }

    await loadFileTree()
    toast({ title: pastedToastTitle })
    return true
  } catch (error) {
    console.error('Paste operation failed:', error)
    toast({ title: pasteFailedToastTitle, variant: 'destructive' })
    return false
  }
}
