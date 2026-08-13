import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "@/components/ui/enhanced-context-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import useArticleStore, { DirTree } from "@/stores/article";
import { BaseDirectory, exists, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { Archive, Copy, Database, Download, File, FileCode, FileJson, FileLock2, FileText, FileUp, FolderOpen, ImageIcon, LoaderCircle, RefreshCwOff, Trash2 } from "lucide-react"
import { useEffect, useRef, useState, useCallback } from "react";
import { ask } from '@tauri-apps/plugin-dialog';
import { Store } from '@tauri-apps/plugin-store';
import { cloneDeep } from "lodash-es";
import { openPath } from "@tauri-apps/plugin-opener";
import { computedParentPath, getCurrentFolder } from "@/lib/path";
import { toast } from "@/hooks/use-toast";
import { useTranslations } from "next-intl";
import useClipboardStore from "@/stores/clipboard";
import { appDataDir, join } from '@tauri-apps/api/path';
import { getSyncPathWritePolicy } from '@/lib/sync/connector-mappings'
import { getSyncManager } from '@/lib/sync/sync-manager'
import { generateUniqueFilename } from "@/lib/default-filename";
import { MobileActionMenu, MobileMenuItem, MobileSeparator } from "./mobile-action-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import useSettingStore from "@/stores/setting";
import { VectorKnowledgeMenu } from "./vector-knowledge-menu";
import { isSkillsFolder } from "@/lib/skills/utils";
import { getDailyReportDateFromPath, isLearningReportMarkdown, removeLearningReportMarkdown } from '@/lib/learning/report'
import { exportMarkdownFile, type MarkdownExportFormat } from "../editor/markdown/markdown-export";
import { setFileManagerDragData } from "./file-dnd";
import { debugSyncPath } from "@/lib/sync/remote-file";
import { BatchSelectionContextMenu } from "./batch-selection-context-menu";
import { getTopLevelSelectionEntries, type FileSelectionEntry } from "./file-selection";
import { pasteIntoFolder } from "./folder-item/paste-into-folder";
import { downloadRemoteLibraryFile, uploadLocalLibraryFile } from "@/lib/sync/remote-library";
import { useShallow } from 'zustand/react/shallow';
import { FileTreeRow, type FileTreeItemProps } from "./file-tree-row";
import { Badge } from '@/components/ui/badge'
import { getFileTreeSyncStatus, getSyncConfiguration, validateFileTreeName, type FileTreeSyncStatus } from "./file-tree-action-policy";
import { useSettingsDialogStore } from "@/stores/settings-dialog";
import { FileTreeDecorations } from "./file-tree-decorations";
import { moveEntryToSystemTrash } from './system-trash'
import { rewriteWorkspaceMarkdownMediaPaths } from '@/lib/markdown-media-path'
import useLearningStore from '@/stores/learning'
import emitter from '@/lib/emitter'

function shouldAutoSyncOnInitialRead(options?: { isNewFile?: boolean }) {
  return options?.isNewFile !== true
}

function buildFileRenamePlan({
  originalName,
  currentPath,
  enteredName,
}: {
  originalName: string
  currentPath: string
  enteredName: string
}) {
  const needsMarkdownSuffix = originalName === '' && !enteredName.endsWith('.md')
  const displayName = needsMarkdownSuffix ? `${enteredName}.md` : enteredName
  const parentPath = currentPath.split('/').slice(0, -1).join('/')
  const targetRelativePath = parentPath ? `${parentPath}/${displayName}` : displayName

  return {
    operation: originalName === '' ? 'create' : 'rename',
    displayName,
    targetRelativePath,
  } as const
}

function showPdfExportStartToast() {
  toast({
    title: '正在准备 PDF',
    description: '请在系统打印窗口中选择“另存为 PDF”。',
  })
}

export function FileItem({
  item,
  focusSidebar,
  selectedPathSet,
  selectionEntries,
  treeItemProps,
  level = 0,
  syncStatus: providedSyncStatus,
}: {
  item: DirTree
  focusSidebar?: () => void
  selectedPathSet: Set<string>
  selectionEntries: FileSelectionEntry[]
  treeItemProps?: FileTreeItemProps
  level?: number
  syncStatus?: FileTreeSyncStatus
}) {
  const [isEditing, setIsEditing] = useState(item.isEditing)
  const [name, setName] = useState(item.name)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [, setIsComposing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const {
    activeFilePath,
    setActiveFilePath,
    readArticle,
    fileTree,
    setFileTree,
    loadFileTree,
    vectorIndexedFiles,
    showKnowledgeBaseStatus,
    checkFileVectorIndexed,
    cleanTabsByDeletedFile,
    cleanTabsByDeletedFolder,
    setSelectedFilePaths,
    setEntryLoading,
    setEntrySyncError,
    markFileLocal,
    reconcileLocalFile,
    clearFileRemoteState,
  } = useArticleStore(useShallow((state) => ({
    activeFilePath: state.activeFilePath,
    setActiveFilePath: state.setActiveFilePath,
    readArticle: state.readArticle,
    fileTree: state.fileTree,
    setFileTree: state.setFileTree,
    loadFileTree: state.loadFileTree,
    vectorIndexedFiles: state.vectorIndexedFiles,
    showKnowledgeBaseStatus: state.showKnowledgeBaseStatus,
    checkFileVectorIndexed: state.checkFileVectorIndexed,
    cleanTabsByDeletedFile: state.cleanTabsByDeletedFile,
    cleanTabsByDeletedFolder: state.cleanTabsByDeletedFolder,
    setSelectedFilePaths: state.setSelectedFilePaths,
    setEntryLoading: state.setEntryLoading,
    setEntrySyncError: state.setEntrySyncError,
    markFileLocal: state.markFileLocal,
    reconcileLocalFile: state.reconcileLocalFile,
    clearFileRemoteState: state.clearFileRemoteState,
  })))
  const { setClipboardItem, clipboardItem, clipboardItems, clipboardOperation } = useClipboardStore()
  const { fileManagerTextSize, primaryBackupMethod } = useSettingStore()
  const t = useTranslations('article.file')
  const tSync = useTranslations('settings.sync')
  const tCommon = useTranslations('common')
  const isMobile = useIsMobile()
  const [exportingFormat, setExportingFormat] = useState<MarkdownExportFormat | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isArchivingReport, setIsArchivingReport] = useState(false)

  // 检查路径是否在 skills 文件夹下
  const isInSkillsFolder = (itemPath: string): boolean => {
    const parts = itemPath.split('/')
    return parts.some(part => isSkillsFolder(part))
  }

  const path = computedParentPath(item)
  const [canWriteRemote, setCanWriteRemote] = useState(false)
  const [isReadOnlySync, setIsReadOnlySync] = useState(false)

  useEffect(() => {
    let cancelled = false
    const refreshPolicy = () => {
      setCanWriteRemote(false)
      setIsReadOnlySync(false)
      void getSyncPathWritePolicy(path).then((policy) => {
        if (!cancelled) {
          setCanWriteRemote(policy.writable)
          setIsReadOnlySync(policy.blockedByReadOnly)
        }
      })
    }
    refreshPolicy()
    emitter.on('sync-mappings-changed', refreshPolicy)
    return () => {
      cancelled = true
      emitter.off('sync-mappings-changed', refreshPolicy)
    }
  }, [path])
  const isLearningReport = isLearningReportMarkdown('', path)
  const dailyReportDate = getDailyReportDateFromPath(path)

  async function handleArchiveDailyReport() {
    if (!dailyReportDate || isArchivingReport) return
    if (!window.confirm(`确定归档 ${dailyReportDate} 的日报吗？系统会先生成或更新所属规划周报，再归档该日报。`)) return

    setIsArchivingReport(true)
    try {
      const weeklyReport = await useLearningStore.getState().archiveReport(dailyReportDate)
      await removeLearningReportMarkdown(path)
      await cleanTabsByDeletedFile(path)
      useArticleStore.getState().removeLocalEntry(path)
      await loadFileTree({ skipRemoteSync: true })
      toast({ title: '日报已归档并汇总进规划周报', description: weeklyReport.title })
    } catch (error) {
      toast({
        title: '归档日报失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setIsArchivingReport(false)
    }
  }

  // 向量状态更新回调
  const handleVectorUpdated = useCallback(() => {
    checkFileVectorIndexed(path)
  }, [path, checkFileVectorIndexed])

  // 根据文字大小映射图标大小
  const getIconSize = (textSize: string) => {
    const sizeMap = {
      'xs': 'size-3',
      'sm': 'size-3.5',
      'md': 'size-4',
      'lg': 'size-5',
      'xl': 'size-6'
    }
    return sizeMap[textSize as keyof typeof sizeMap] || 'size-4'
  }

  const iconSize = getIconSize(fileManagerTextSize)
  const syncStatus = providedSyncStatus ?? getFileTreeSyncStatus(item)
  const syncStatusTitle = item.syncError
    ?? (isReadOnlySync && syncStatus === 'dirty'
      ? tSync('mapping.readOnlyLocalChanges')
      : t(`syncStatus.${syncStatus}`))

  // 检查文件是否被剪切
  const isCut = clipboardOperation === 'cut' && clipboardItems.some(entry => entry.path === path)
  const isSelected = selectedPathSet.has(path)
  const useSelectionMenu = isSelected && selectionEntries.length > 1

  // 检查文件是否已计算向量（skills 文件夹下的文件不显示）
  const hasVector = item.isFile && !isInSkillsFolder(path) && vectorIndexedFiles.has(path)
  const canExportMarkdownFile = item.isLocale && item.name !== '' && /\.(md|markdown|txt)$/i.test(item.name)

  // 向量计算状态图标
  const renderVectorIcon = () => {
    if (!showKnowledgeBaseStatus || isInSkillsFolder(path)) return null

    const status = item.vectorCalcStatus

    if (status === 'calculating') {
      return (
        <span title={t('context.knowledgeBase')} aria-label={t('context.knowledgeBase')}>
          <LoaderCircle className={`${iconSize} shrink-0 animate-spin text-muted-foreground`} />
        </span>
      )
    } else if (status === 'completed' || hasVector) {
      return (
        <span title={t('context.knowledgeBase')} aria-label={t('context.knowledgeBase')}>
          <Database className={`${iconSize} shrink-0 text-muted-foreground opacity-60`} />
        </span>
      )
    }
    return null
  }

  const renderFileTypeIcon = () => {
    if (isLearningReport) {
      return <FileLock2 className={`${iconSize} shrink-0 text-sky-600 dark:text-sky-400`} />
    }
    if (item.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i)) {
      return <ImageIcon className={`${iconSize} shrink-0`} />
    }
    if (item.name.match(/\.(md|markdown|txt)$/i)) {
      return <FileText className={`${iconSize} shrink-0`} />
    }
    if (item.name.match(/\.(json|yaml|yml|toml)$/i)) {
      return <FileJson className={`${iconSize} shrink-0`} />
    }
    if (item.name.match(/\.(py|js|ts|jsx|tsx|css|scss|less|html|xml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro)$/i)) {
      return <FileCode className={`${iconSize} shrink-0`} />
    }
    return <File className={`${iconSize} shrink-0`} />
  }

  const folderPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''
  // 不需要 cloneDeep，因为 getCurrentFolder 只读取数据不修改
  const currentFolder = getCurrentFolder(folderPath, fileTree)

  // 优化的输入处理，支持输入法
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value)
    setRenameError(null)
  }, [])

  // 输入法合成开始
  const handleCompositionStart = useCallback(() => {
    setIsComposing(true)
  }, [])

  // 输入法合成结束
  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLInputElement>) => {
    setIsComposing(false)
    setName(e.currentTarget.value)
  }, [])

  async function handleSelectFile() {
    // 让文件管理器获得焦点，以便响应快捷键
    focusSidebar?.()
    const currentPath = computedParentPath(item)

    if (!item.isLocale) {
      setEntryLoading(currentPath, true)
      try {
        await downloadRemoteLibraryFile(currentPath)
        markFileLocal(currentPath)
      } catch (error) {
        toast({
          title: t('cloudLibrary.operationFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        })
        return
      } finally {
        setEntryLoading(currentPath, false)
      }
    }

    if (item.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i)) {
      // 图片文件：设置 activeFilePath，让 EditorLayout 显示图片编辑器
      setActiveFilePath(currentPath)
    } else if (item.name.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template)$/i)) {
      // Markdown/文本文件：设置 activeFilePath
      setActiveFilePath(currentPath)

      // 检查是否是远程文件
      // 读取内容的逻辑移到 EditorLayout 中处理，避免重复渲染
    } else {
      // 其他文件类型：设置 activeFilePath，让 EditorLayout 显示 UnsupportedFile 组件
      setActiveFilePath(currentPath)
    }
  }

  function handleFileClick(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    focusSidebar?.()
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      return
    }

    void handleSelectFile()
  }

  function handleFileContextMenu(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    e.stopPropagation()
    focusSidebar?.()
    if (!isSelected) {
      setSelectedFilePaths([path])
    }
  }

  async function handleDeleteFile() {
    // 添加确认弹窗
    const answer = await ask(t('deleteConfirm'), {
      title: item.name,
      kind: 'warning',
    });
    // 如果用户确认删除，则继续执行
    if (answer) {
      try {
        // 使用当前路径，而不是重新计算的路径
        const currentPath = computedParentPath(item)
        const trashed = await moveEntryToSystemTrash(currentPath)

        reconcileLocalFile(currentPath, false)
        await cleanTabsByDeletedFile(currentPath)
        if (vectorIndexedFiles.has(currentPath)) {
          const nextVectorIndexedFiles = new Map(useArticleStore.getState().vectorIndexedFiles)
          nextVectorIndexedFiles.delete(currentPath)
          useArticleStore.setState({ vectorIndexedFiles: nextVectorIndexedFiles })
        }
        toast({
          title: t('context.movedToTrash', { count: trashed ? 1 : 0 }),
        })
      } catch (error) {
        console.error('Delete file failed:', error)
        toast({
          title: t('context.deleteLocalFile'),
          description: '删除文件失败: ' + error,
          variant: 'destructive'
        })
      }
    }
  }

  async function handleDeleteSyncFile() {
    const writePolicy = await getSyncPathWritePolicy(computedParentPath(item))
    if (!writePolicy.writable) {
      toast({
        title: t('context.delete'),
        description: writePolicy.ambiguous
          ? tSync('mapping.deleteAmbiguous')
          : tSync('readOnlyWriteBlocked'),
        variant: 'destructive',
      })
      return
    }
    const answer = await ask(t('context.deleteSyncFile') + '?', {
      title: item.name,
      kind: 'warning',
    });
    if (answer) {
      const currentPath = computedParentPath(item)

      setEntryLoading(currentPath, true)

      try {
        const result = await getSyncManager().deleteRemoteFile(currentPath)
        const success = result.success

        if (success) {
          clearFileRemoteState(currentPath)

          toast({
            title: t('context.delete'),
            description: t('context.deleteSyncFileSuccess'),
          });
        } else {
          setEntryLoading(currentPath, false)
          throw new Error('删除操作返回失败')
        }
      } catch (error) {
        setEntryLoading(currentPath, false)
        console.error('[handleDeleteSyncFile] 删除远程文件失败:', error);
        toast({
          title: t('context.delete'),
          description: t('context.deleteSyncFileError'),
          variant: 'destructive',
        });
      }
    }
  }

  async function handleStartRename() {
    // 延迟执行，确保上下文菜单完全关闭
    setTimeout(() => {
      setIsEditing(true)
      setRenameError(null)
      setTimeout(() => {
        const input = inputRef.current
        if (input) {
          input.focus()
          // 只选中文件名，不包含扩展名
          const lastDotIndex = item.name.lastIndexOf('.')
          if (lastDotIndex > 0) {
            input.setSelectionRange(0, lastDotIndex)
          } else {
            input.select()
          }
        }
      }, 100)
    }, 300)
  }

  async function handleRename() {
    // 获取工作区路径信息
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
    const originalName = item.name
    const nextTree = cloneDeep(fileTree)
    const nextFolder = getCurrentFolder(folderPath, nextTree)
    
    let finalName = name
    
    // 如果输入为空字符串，生成默认文件名
    if (!name || name.trim() === '') {
      const parentPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''
      finalName = await generateUniqueFilename(parentPath, 'Untitled')
      setName(finalName)
    } else {
      finalName = name
      setName(finalName)
    }
  
    if (finalName && finalName.trim() !== '' && finalName !== originalName) {
      if (validateFileTreeName(finalName)) {
        setRenameError(t('error.invalidName'))
        setTimeout(() => inputRef.current?.focus(), 0)
        return
      }
      const renamePlan = buildFileRenamePlan({
        originalName,
        currentPath: path,
        enteredName: finalName,
      })
      debugSyncPath('file.renamePlan', {
        originalName,
        enteredName: finalName,
        displayName: renamePlan.displayName,
        targetRelativePath: renamePlan.targetRelativePath,
      })
      const { displayName, operation, targetRelativePath } = renamePlan
      
      // 更新缓存树中的名称
      if (nextFolder && nextFolder.children) {
        const fileIndex = nextFolder?.children?.findIndex(file => file.name === originalName)
        if (fileIndex !== undefined && fileIndex !== -1) {
          nextFolder.children[fileIndex].name = displayName
          nextFolder.children[fileIndex].isEditing = false
        }
      } else {
        const fileIndex = nextTree.findIndex(file => file.name === originalName)
        if (fileIndex !== -1 && fileIndex !== undefined) {
          nextTree[fileIndex].name = displayName
          nextTree[fileIndex].isEditing = false
        }
      }
      // 确定是重命名现有文件还是创建新文件
      if (operation === 'rename') {
        // 重命名现有文件
        // 获取源路径和目标路径
        const oldPathOptions = await getFilePathOptions(path)
        const newPathOptions = await getFilePathOptions(targetRelativePath)
        const targetExists = workspace.isCustom
          ? await exists(newPathOptions.path)
          : await exists(newPathOptions.path, { baseDir: newPathOptions.baseDir })
        if (targetExists) {
          setRenameError(t('error.fileExists'))
          setTimeout(() => inputRef.current?.focus(), 0)
          return
        }
        
        // 根据工作区类型执行重命名操作
        try {
          if (workspace.isCustom) {
            await rename(oldPathOptions.path, newPathOptions.path)
          } else {
            await rename(oldPathOptions.path, newPathOptions.path, {
              newPathBaseDir: BaseDirectory.AppData,
              oldPathBaseDir: BaseDirectory.AppData
            })
          }
          try {
            await rewriteWorkspaceMarkdownMediaPaths([{
              sourcePath: path,
              targetPath: targetRelativePath,
            }])
          } catch (error) {
            if (workspace.isCustom) {
              await rename(newPathOptions.path, oldPathOptions.path)
            } else {
              await rename(newPathOptions.path, oldPathOptions.path, {
                newPathBaseDir: BaseDirectory.AppData,
                oldPathBaseDir: BaseDirectory.AppData,
              })
            }
            throw error
          }
        } catch (error) {
          setRenameError(error instanceof Error ? error.message : String(error))
          setTimeout(() => inputRef.current?.focus(), 0)
          return
        }
        const { renameVectorDocumentsByFilename } = await import('@/db/vector')
        await renameVectorDocumentsByFilename(path, targetRelativePath)
      } else {
        // 创建新文件
        const pathOptions = await getFilePathOptions(targetRelativePath)
        
        // 检查文件是否已存在
        let isExists = false
        if (workspace.isCustom) {
          isExists = await exists(pathOptions.path)
        } else {
          isExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
        
        if (isExists) {
          setRenameError(t('error.fileExists'))
          setTimeout(() => inputRef.current?.focus(), 0)
          return
        } else {
          // 创建新文件
          if (workspace.isCustom) {
            await writeTextFile(pathOptions.path, '')
          } else {
            await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
          }
        }
      }
      setFileTree(nextTree)
      
      // 构建新文件的完整路径用于激活文件
      let newPath = targetRelativePath
      // 判断 newPath 是否以 / 开头
      if (newPath.startsWith('/')) {
        newPath = newPath.slice(1)
      }
      setActiveFilePath(newPath)
      // 新建文件后自动选择该文件并读取内容
      readArticle(newPath, '', shouldAutoSyncOnInitialRead({ isNewFile: true }))
    } else {
      // 处理取消创建或无变更的情况
      if (originalName === '') {
        // 只有当原文件名为空（新建文件）时才删除列表项
        if (currentFolder && currentFolder.children) {
          const index = currentFolder?.children?.findIndex(item => item.name === '')
          if (index !== undefined && index !== -1 && currentFolder?.children) {
            currentFolder?.children?.splice(index, 1)
          }
          setFileTree(fileTree)
        } else {
          // 根目录文件：需要克隆 fileTree 来更新
          const cacheTree = cloneDeep(fileTree)
          const index = cacheTree.findIndex(item => item.name === '')
          if (index !== -1) {
            cacheTree.splice(index, 1)
          }
          setFileTree(cacheTree)
        }
      } else {
        // 对于重命名现有文件，如果没有输入新名称，则保持原状态
        if (currentFolder && currentFolder.children) {
          const fileIndex = currentFolder?.children?.findIndex(file => file.name === item.name)
          if (fileIndex !== undefined && fileIndex !== -1) {
            currentFolder.children[fileIndex].isEditing = false
          }
          setFileTree(fileTree)
        } else {
          // 根目录文件：需要克隆 fileTree 来更新
          const cacheTree = cloneDeep(fileTree)
          const fileIndex = cacheTree.findIndex(file => file.name === item.name)
          if (fileIndex !== -1 && fileIndex !== undefined) {
            cacheTree[fileIndex].isEditing = false
          }
          setFileTree(cacheTree)
        }
      }
    }

    setIsEditing(false)
  }

  async function handleShowFileManager() {
    // 获取工作区路径信息
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
    
    // 确定文件所在的目录路径
    const folderPath = item.parent ? computedParentPath(item.parent) : ''
    
    // 根据工作区类型确定正确的路径
    if (workspace.isCustom) {
      // 自定义工作区 - 直接使用工作区路径
      const pathOptions = await getFilePathOptions(folderPath)
      openPath(pathOptions.path)
    } else {
      // 默认工作区 - 使用 AppData 目录
      const appDir = await appDataDir()
      openPath(await join(appDir, 'article', folderPath))
    }
  }

  function handleDragStart(ev: React.DragEvent<HTMLElement>) {
    const selectedPaths = selectedPathSet.has(path)
      ? getTopLevelSelectionEntries(selectionEntries).map(entry => entry.path)
      : [path]
    setFileManagerDragData(ev.dataTransfer, selectedPaths)
  }

  async function handleCopyFile() {
    setClipboardItem({
      path,
      name: item.name,
      isDirectory: false,
      sha: item.sha,
      isLocale: item.isLocale
    }, 'copy')
    toast({ title: t('clipboard.copied') })
  }

  async function handleCutFile() {
    setClipboardItem({
      path,
      name: item.name,
      isDirectory: false,
      sha: item.sha,
      isLocale: item.isLocale
    }, 'cut')
    toast({ title: t('clipboard.cut') })
  }

  async function handlePasteFile() {
    const targetDir = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''
    await pasteIntoFolder({
      clipboardItem,
      clipboardItems,
      clipboardOperation,
      folderPath: targetDir,
      emptyToastTitle: t('clipboard.empty'),
      pastedToastTitle: t('clipboard.pasted'),
      pasteFailedToastTitle: t('clipboard.pasteFailed'),
      loadFileTree,
      setClipboardItem,
      cleanTabsByDeletedFile,
      cleanTabsByDeletedFolder,
    })
  }

  async function handleExportFile(format: MarkdownExportFormat) {
    try {
      setExportingFormat(format)
      const exported = await exportMarkdownFile(
        format,
        path,
        { onPdfRenderStart: showPdfExportStartToast },
      )

      if (exported) {
        toast({ title: format === 'pdf' ? '已打开 PDF 打印窗口' : '导出成功' })
      }
    } catch (error) {
      console.error(`Export selected file failed: ${path}`, error)
      toast({
        title: '导出失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setExportingFormat(null)
    }
  }

  async function handleUploadFile() {
    if (isUploading || !item.isLocale || item.name === '') return
    const writePolicy = await getSyncPathWritePolicy(path)
    if (!writePolicy.writable) {
      toast({
        title: t('context.uploadFileError'),
        description: writePolicy.ambiguous
          ? tSync('mapping.uploadAmbiguous')
          : tSync('readOnlyWriteBlocked'),
        variant: 'destructive',
      })
      return
    }
    const sync = await getSyncConfiguration(path)
    if (!sync.configured) {
      toast({
        title: sync.reason === 'missing-repository'
          ? t('context.syncRepoRequired')
          : t('context.syncNotConfigured'),
        description: t('context.configureSync'),
      })
      useSettingsDialogStore.getState().openSettings('sync')
      return
    }

    setIsUploading(true)
    setEntryLoading(path, true)
    setEntrySyncError(path)
    const progressToast = toast({
      title: t('context.uploadFileProgress'),
      description: item.name,
      duration: Infinity,
    })
    try {
      const sha = await uploadLocalLibraryFile(path)
      useArticleStore.getState().markFileRemote(path, sha)
      progressToast.update({
        title: t('context.uploadFileSuccess'),
        description: item.name,
        duration: 3000,
      })
    } catch (error) {
      setEntrySyncError(path, error instanceof Error ? error.message : String(error))
      progressToast.update({
        title: t('context.uploadFileError'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
        duration: 5000,
      })
    } finally {
      setEntryLoading(path, false)
      setIsUploading(false)
    }
  }

  async function handleEditEnd() {
    if (currentFolder && currentFolder.children) {
      const index = currentFolder?.children?.findIndex(item => item.name === '')
      if (index !== undefined && index !== -1 && currentFolder?.children) {
        currentFolder?.children?.splice(index, 1)
      }
      setFileTree(fileTree)
    } else {
      // 根目录文件：需要克隆 fileTree 来更新
      const cacheTree = cloneDeep(fileTree)
      const index = cacheTree.findIndex(item => item.name === '')
      if (index !== -1) {
        cacheTree.splice(index, 1)
      }
      setFileTree(cacheTree)
    }
    setIsEditing(false)
  }

  useEffect(() => {
    if (item.isEditing) {
      setIsEditing(true)
      setName(item.name)
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [item])

  // 监听文件管理器统一快捷键触发的自定义事件
  useEffect(() => {
    const handleRenameEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ path: string }>
      if (customEvent.detail.path === path) {
        handleStartRename()
      }
    }

    const handleDeleteEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ item: { path: string } }>
      if (customEvent.detail.item.path === path) {
        handleDeleteFile()
      }
    }

    const handlePasteEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ targetPath: string }>
      // 粘贴到文件所在目录（同级粘贴）
      if (customEvent.detail.targetPath === path) {
        handlePasteFile()
      }
    }

    window.addEventListener('filemanager-rename', handleRenameEvent)
    window.addEventListener('filemanager-delete', handleDeleteEvent)
    window.addEventListener('filemanager-paste', handlePasteEvent)

    return () => {
      window.removeEventListener('filemanager-rename', handleRenameEvent)
      window.removeEventListener('filemanager-delete', handleDeleteEvent)
      window.removeEventListener('filemanager-paste', handlePasteEvent)
    }
  }, [path, handleStartRename, handleDeleteFile, handlePasteFile])

  // 获取当前平台（用于显示快捷键）
  // 快捷键显示文本
  const modKey = 'Ctrl'
  const deleteKey = 'Del'
  const renameKey = 'F2'
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <FileTreeRow
            path={path}
            kind="file"
            level={level}
            active={path === activeFilePath}
            selected={isSelected}
            treeItemProps={treeItemProps}
            onActivate={handleFileClick}
            onContextMenu={handleFileContextMenu}
            className={isLearningReport ? 'bg-sky-500/[0.045]' : undefined}
          >
            {
              isEditing ? 
              <div className="flex min-w-0 w-full items-center gap-1 select-none">
                <File className={`${iconSize} shrink-0`} />
                <Input
                  ref={inputRef}
                  className={`h-5 min-w-0 flex-1 rounded-sm text-${fileManagerTextSize} px-1 font-normal mr-1 ${renameError ? 'border-destructive focus-visible:ring-destructive/30' : ''}`}
                  value={name}
                  aria-invalid={Boolean(renameError)}
                  title={renameError ?? undefined}
                  onBlur={handleRename}
                  onChange={handleInputChange}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(e) => {
                    // 阻止删除快捷键冒泡到全局快捷键处理器
                    if (e.key === 'Backspace' || e.key === 'Delete') {
                      e.stopPropagation()
                    }
                    if (e.code === 'Enter' && !e.nativeEvent.isComposing) {
                      handleRename()
                    } else if (e.code === 'Escape') {
                      handleEditEnd()
                    }
                  }}
                />
                {renameError ? (
                  <Badge variant="destructive" className="mr-1 max-w-28 shrink-0 truncate">
                    {renameError}
                  </Badge>
                ) : null}
              </div> :
              item.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i) ?
              <span
                title={item.name}
                className={`${!item.isLocale || isCut ? 'opacity-50' : ''} flex min-w-0 flex-1 select-none items-center justify-between gap-1 overflow-hidden dark:hover:text-white`}>
                <div
                  data-file-manager-drag-handle
                  draggable
                  onDragStart={handleDragStart}
                  className="relative flex min-w-0 flex-1 cursor-default select-none items-center gap-1 overflow-hidden"
                >
                  <div className="relative flex shrink-0 items-center">{renderFileTypeIcon()}</div>
                  <span className={`text-${fileManagerTextSize} min-w-0 flex-1 truncate`}>{item.name}</span>
                </div>
                <FileTreeDecorations
                  iconSize={iconSize}
                  knowledge={renderVectorIcon()}
                  syncStatus={syncStatus}
                  syncTitle={syncStatusTitle}
                  readOnly={isReadOnlySync}
                />
                  {isMobile && (
                    <MobileActionMenu className="ml-1">
                    <MobileMenuItem onClick={handleShowFileManager}>
                      {t('context.viewDirectory')}
                    </MobileMenuItem>
                      <MobileSeparator />
                      {dailyReportDate ? (
                        <MobileMenuItem disabled={isArchivingReport} onClick={() => void handleArchiveDailyReport()}>
                          归档日报
                        </MobileMenuItem>
                      ) : null}
                      {dailyReportDate ? <MobileSeparator /> : null}
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleCutFile}>
                      {t('context.cut')}
                    </MobileMenuItem>
                    <MobileMenuItem onClick={handleCopyFile}>
                      {t('context.copy')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!clipboardItem && clipboardItems.length === 0} onClick={handlePasteFile}>
                      {t('context.paste')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={isUploading || !item.isLocale || item.name === '' || !canWriteRemote} onClick={() => void handleUploadFile()}>
                      {t('context.uploadFile')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleStartRename}>
                      {t('context.rename')}
                    </MobileMenuItem>
                    {primaryBackupMethod !== 'cloudFolder' ? (
                      <MobileMenuItem disabled={!item.sha || !canWriteRemote} className="text-red-600" onClick={handleDeleteSyncFile}>
                        {t('context.deleteSyncFile')}
                      </MobileMenuItem>
                    ) : null}
                    <MobileMenuItem disabled={!item.isLocale || item.name === ''} className="text-red-600" onClick={handleDeleteFile}>
                      {t('context.deleteLocalFile')}
                    </MobileMenuItem>
                  </MobileActionMenu>
                )}
              </span> :
              <span
                title={item.name}
                className={`${!item.isLocale || isCut ? 'opacity-50' : ''} flex min-w-0 flex-1 select-none items-center justify-between gap-1 overflow-hidden dark:hover:text-white`}>
                <div
                  data-file-manager-drag-handle
                  draggable
                  onDragStart={handleDragStart}
                  className="relative flex min-w-0 flex-1 cursor-default select-none items-center gap-1 overflow-hidden"
                >
                  <div className="relative flex shrink-0 items-center">{renderFileTypeIcon()}</div>
                  <span className={`text-${fileManagerTextSize} min-w-0 flex-1 truncate ${isLearningReport ? 'font-medium text-sky-700 dark:text-sky-300' : ''}`}>{item.name}</span>
                  {isLearningReport ? <Badge variant="outline" className="h-4 shrink-0 border-sky-500/30 bg-sky-500/10 px-1 text-[10px] font-normal text-sky-700 dark:text-sky-300">只读</Badge> : null}
                  {dailyReportDate ? (
                    <button
                      type="button"
                      disabled={isArchivingReport}
                      className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50"
                      title="归档日报"
                      aria-label="归档日报"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        void handleArchiveDailyReport()
                      }}
                    >
                      {isArchivingReport ? <LoaderCircle className="size-3.5 animate-spin" /> : <Archive className="size-3.5" />}
                    </button>
                  ) : null}
                </div>
                <FileTreeDecorations
                  iconSize={iconSize}
                  knowledge={renderVectorIcon()}
                  syncStatus={syncStatus}
                  syncTitle={syncStatusTitle}
                  readOnly={isReadOnlySync}
                />
                {isMobile && (
                  <MobileActionMenu className="ml-1">
                    <MobileMenuItem onClick={handleShowFileManager}>
                      {t('context.viewDirectory')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    {dailyReportDate ? (
                      <>
                        <MobileMenuItem disabled={isArchivingReport} onClick={() => void handleArchiveDailyReport()}>
                          归档日报
                        </MobileMenuItem>
                        <MobileSeparator />
                      </>
                    ) : null}
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleCutFile}>
                      {t('context.cut')}
                    </MobileMenuItem>
                    <MobileMenuItem onClick={handleCopyFile}>
                      {t('context.copy')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!clipboardItem && clipboardItems.length === 0} onClick={handlePasteFile}>
                      {t('context.paste')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={isUploading || !item.isLocale || item.name === '' || !canWriteRemote} onClick={() => void handleUploadFile()}>
                      {t('context.uploadFile')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleStartRename}>
                      {t('context.rename')}
                    </MobileMenuItem>
                    {primaryBackupMethod !== 'cloudFolder' ? (
                      <MobileMenuItem disabled={!item.sha || !canWriteRemote} className="text-red-600" onClick={handleDeleteSyncFile}>
                        {t('context.deleteSyncFile')}
                      </MobileMenuItem>
                    ) : null}
                    <MobileMenuItem disabled={!item.isLocale || item.name === ''} className="text-red-600" onClick={handleDeleteFile}>
                      {t('context.deleteLocalFile')}
                    </MobileMenuItem>
                  </MobileActionMenu>
                )}
              </span>
            }
          </FileTreeRow>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {useSelectionMenu ? (
            <BatchSelectionContextMenu entries={selectionEntries} modKey={modKey} deleteKey={deleteKey} />
          ) : (
            <>
              <ContextMenuItem inset onClick={handleShowFileManager} menuType="file">
                <FolderOpen className="mr-2 h-4 w-4" />
                {t('context.viewDirectory')}
              </ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger inset disabled={!canExportMarkdownFile || exportingFormat !== null} menuType="file">
                  <Download className="mr-2 h-4 w-4" />
                  {tCommon('export')}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuItem
                    inset
                    disabled={exportingFormat !== null}
                    onClick={() => { void handleExportFile('markdown') }}
                    menuType="file"
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    Markdown
                  </ContextMenuItem>
                  <ContextMenuItem
                    inset
                    disabled={exportingFormat !== null}
                    onClick={() => { void handleExportFile('html') }}
                    menuType="file"
                  >
                    <FileCode className="mr-2 h-4 w-4" />
                    HTML
                  </ContextMenuItem>
                  <ContextMenuItem
                    inset
                    disabled={exportingFormat !== null}
                    onClick={() => { void handleExportFile('json') }}
                    menuType="file"
                  >
                    <FileJson className="mr-2 h-4 w-4" />
                    JSON
                  </ContextMenuItem>
                  <ContextMenuItem
                    inset
                    disabled={exportingFormat !== null}
                    onClick={() => { void handleExportFile('pdf') }}
                    menuType="file"
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    PDF
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
              <ContextMenuItem
                inset
                disabled={isUploading || !item.isLocale || item.name === '' || !canWriteRemote}
                onClick={() => void handleUploadFile()}
                menuType="file"
              >
                {isUploading
                  ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  : <FileUp className="mr-2 h-4 w-4" />}
                {t('context.uploadFile')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <VectorKnowledgeMenu
                item={item}
                hasVector={hasVector}
                onVectorUpdated={handleVectorUpdated}
              />
              <ContextMenuSeparator />
              <ContextMenuItem inset disabled={!item.isLocale} onClick={handleCutFile} menuType="file">
                <File className="mr-2 h-4 w-4" />
                {t('context.cut')}
                <ContextMenuShortcut menuType="file">
                  <Kbd>{modKey}X</Kbd>
                </ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem inset onClick={handleCopyFile} menuType="file">
                <Copy className="mr-2 h-4 w-4" />
                {t('context.copy')}
                <ContextMenuShortcut menuType="file">
                  <Kbd>{modKey}C</Kbd>
                </ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem inset disabled={!clipboardItem && clipboardItems.length === 0} onClick={handlePasteFile} menuType="file">
                <File className="mr-2 h-4 w-4" />
                {t('context.paste')}
                <ContextMenuShortcut menuType="file">
                  <Kbd>{modKey}V</Kbd>
                </ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuSeparator />
              {dailyReportDate ? (
                <>
                  <ContextMenuItem inset disabled={isArchivingReport} onClick={() => void handleArchiveDailyReport()} menuType="file">
                    {isArchivingReport ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Archive className="mr-2 h-4 w-4" />}
                    归档日报
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                </>
              ) : null}
              <ContextMenuItem disabled={!item.isLocale} inset onClick={handleStartRename} menuType="file">
                <File className="mr-2 h-4 w-4" />
                {t('context.rename')}
                <ContextMenuShortcut menuType="file">
                  <Kbd>{renameKey}</Kbd>
                </ContextMenuShortcut>
              </ContextMenuItem>
              {primaryBackupMethod !== 'cloudFolder' ? (
                <ContextMenuItem disabled={!item.sha || !canWriteRemote} inset className="text-red-900" onClick={handleDeleteSyncFile} menuType="file">
                  <RefreshCwOff className="mr-2 h-4 w-4" />
                  {t('context.deleteSyncFile')}
                </ContextMenuItem>
              ) : null}
              <ContextMenuItem disabled={!item.isLocale || item.name === ''} inset className="text-red-900" onClick={handleDeleteFile} menuType="file">
                <Trash2 className="mr-2 h-4 w-4" />
                {t('context.deleteLocalFile')}
                <ContextMenuShortcut menuType="file">
                  <Kbd>{deleteKey}</Kbd>
                </ContextMenuShortcut>
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </>
  )
}
