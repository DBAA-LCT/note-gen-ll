import { exists, mkdir, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import type { PeriodicLearningReport, SaveDailyReportInput } from '@/types/learning'

export const LEARNING_REPORT_MARKER = '<!-- notegen:learning-report readonly -->'

function getLearningReportFileInfo(path: string): { type: 'daily' | 'weekly' | 'monthly'; date: string | null } | null {
  const normalizedPath = path.replace(/\\/g, '/')
  const fileName = normalizedPath.split('/').pop()?.toLowerCase() || ''
  if (!fileName.endsWith('.md')) return null

  const dailyDate = fileName.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1] || null
  if (dailyDate && (fileName.endsWith('-日报.md') || fileName.endsWith('-学习日报.md'))) {
    return { type: 'daily', date: dailyDate }
  }
  if (fileName.endsWith('-周报.md') || fileName.endsWith('-学习周报.md')) {
    return { type: 'weekly', date: null }
  }
  if (fileName.endsWith('-月报.md') || fileName.endsWith('-学习月报.md')) {
    return { type: 'monthly', date: null }
  }
  return null
}

export function isLearningReportMarkdown(content: string, path = ''): boolean {
  const normalizedPath = path.replace(/\\/g, '/')
  return content.includes(LEARNING_REPORT_MARKER)
    || getLearningReportFileInfo(normalizedPath) !== null
    || /(?:^|\/)(?:学习报告|规划报告)\/(?:日报|周报|月报)\/.+\.md$/i.test(normalizedPath)
}

export function getDailyReportDateFromPath(path: string): string | null {
  const report = getLearningReportFileInfo(path)
  return report?.type === 'daily' ? report.date : null
}

export async function removeLearningReportMarkdown(path: string | null): Promise<void> {
  if (!path) return
  const fileOptions = await getFilePathOptions(path)
  const fileExists = fileOptions.baseDir
    ? await exists(fileOptions.path, { baseDir: fileOptions.baseDir })
    : await exists(fileOptions.path)
  if (!fileExists) return
  if (fileOptions.baseDir) await remove(fileOptions.path, { baseDir: fileOptions.baseDir })
  else await remove(fileOptions.path)
}

export function buildDailyReportMarkdown(input: SaveDailyReportInput): string {
  const taskLines = input.entries.length
    ? input.entries.map(entry => [
        `### ${entry.goalTitle}`,
        '',
        `- 执行状态：${entry.status === 'done' ? '完成' : entry.status === 'partial' ? '部分完成' : '未完成'}`,
        `- 实际投入：${entry.studyMinutes} 分钟`,
        `- 累计进度：${entry.progressPercent}%`,
        `- 完成内容：${entry.content || '未填写'}`,
      ].join('\n')).join('\n\n')
    : '当天没有关联目标记录。'
  const reflection = input.reflection
  return `${LEARNING_REPORT_MARKER}

# ${input.localDate} 每日回顾

## 今天怎么样

${input.overall || '未填写'}

## 执行内容

${taskLines}

## 留给下一次

- 精力状态：${reflection.energyLevel ?? '未填写'}
- 专注程度：${reflection.focusLevel ?? '未填写'}
- 最大收获：${reflection.biggestWin || '未填写'}
- 主要困难：${reflection.biggestBlocker || '未填写'}
- 下次调整：${reflection.nextIntention || '未填写'}

---

由 NoteGen 根据当天的执行记录整理。
`
}

export async function writeDailyReportMarkdown(
  input: SaveDailyReportInput,
  reportDirectory: string,
): Promise<string> {
  const normalizedDirectory = reportDirectory.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || '规划报告/日报'
  const path = `${normalizedDirectory}/${input.localDate}-日报.md`
  const directoryOptions = await getFilePathOptions(normalizedDirectory)
  const directoryExists = directoryOptions.baseDir
    ? await exists(directoryOptions.path, { baseDir: directoryOptions.baseDir })
    : await exists(directoryOptions.path)
  if (!directoryExists) {
    if (directoryOptions.baseDir) await mkdir(directoryOptions.path, { baseDir: directoryOptions.baseDir, recursive: true })
    else await mkdir(directoryOptions.path, { recursive: true })
  }
  const markdown = buildDailyReportMarkdown(input)
  const fileOptions = await getFilePathOptions(path)
  if (fileOptions.baseDir) await writeTextFile(fileOptions.path, markdown, { baseDir: fileOptions.baseDir })
  else await writeTextFile(fileOptions.path, markdown)
  return path
}

export async function writePeriodicReportMarkdown(
  report: Pick<PeriodicLearningReport, 'type' | 'periodStart' | 'periodEnd' | 'content'>,
  reportDirectory: string,
): Promise<string> {
  const dailyDirectory = reportDirectory.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || '规划报告/日报'
  const rootDirectory = dailyDirectory.endsWith('/日报') ? dailyDirectory.slice(0, -3) : dailyDirectory
  const periodLabel = report.type === 'week' ? '周报' : '月报'
  const directory = `${rootDirectory}/${periodLabel}`
  const path = `${directory}/${report.periodStart}_${report.periodEnd}-${periodLabel}.md`
  const directoryOptions = await getFilePathOptions(directory)
  const directoryExists = directoryOptions.baseDir
    ? await exists(directoryOptions.path, { baseDir: directoryOptions.baseDir })
    : await exists(directoryOptions.path)
  if (!directoryExists) {
    if (directoryOptions.baseDir) await mkdir(directoryOptions.path, { baseDir: directoryOptions.baseDir, recursive: true })
    else await mkdir(directoryOptions.path, { recursive: true })
  }
  const fileOptions = await getFilePathOptions(path)
  const markdown = `${LEARNING_REPORT_MARKER}\n\n${report.content}`
  if (fileOptions.baseDir) await writeTextFile(fileOptions.path, markdown, { baseDir: fileOptions.baseDir })
  else await writeTextFile(fileOptions.path, markdown)
  return path
}
