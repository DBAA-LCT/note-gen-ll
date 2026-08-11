import { invoke } from '@tauri-apps/api/core'
import { exists } from '@tauri-apps/plugin-fs'

import { getDefaultArticleAbsolutePath, getFilePathOptions } from '@/lib/workspace'

async function resolveExistingAbsolutePath(relativePath: string) {
  const options = await getFilePathOptions(relativePath)
  const pathExists = options.baseDir
    ? await exists(options.path, { baseDir: options.baseDir })
    : await exists(options.path)

  if (!pathExists) return null
  return options.baseDir
    ? getDefaultArticleAbsolutePath(relativePath)
    : options.path
}

export async function moveEntriesToSystemTrash(relativePaths: string[]) {
  const resolvedPaths = await Promise.all(relativePaths.map(resolveExistingAbsolutePath))
  const paths = resolvedPaths.filter((path): path is string => Boolean(path))

  if (paths.length === 0) return 0
  await invoke('move_paths_to_trash', { paths })
  return paths.length
}

export async function moveEntryToSystemTrash(relativePath: string) {
  return (await moveEntriesToSystemTrash([relativePath])) > 0
}
