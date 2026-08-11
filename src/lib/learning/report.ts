import { exists, mkdir, writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import type { PeriodicLearningReport, SaveDailyReportInput } from '@/types/learning'

export function buildDailyReportMarkdown(input: SaveDailyReportInput): string {
  const taskLines = input.entries.length
    ? input.entries.map(entry => [
        `### ${entry.goalTitle}`,
        '',
        `- 执行状态：${entry.status === 'done' ? '完成' : entry.status === 'partial' ? '部分完成' : '未完成'}`,
        `- 实际学习：${entry.studyMinutes} 分钟`,
        `- 累计进度：${entry.progressPercent}%`,
        `- 学习内容：${entry.content || '未填写'}`,
      ].join('\n')).join('\n\n')
    : '当天没有关联目标记录。'
  const reflection = input.reflection
  return `# ${input.localDate} 学习日报

## 总体总结

${input.overall || '未填写'}

## 目标执行

${taskLines}

## 学习复盘

- 精力状态：${reflection.energyLevel ?? '未填写'}
- 专注程度：${reflection.focusLevel ?? '未填写'}
- 最大收获：${reflection.biggestWin || '未填写'}
- 主要困难：${reflection.biggestBlocker || '未填写'}
- 下次调整：${reflection.nextIntention || '未填写'}

---

由 NoteGen 学习模块生成。结构化统计保存在本地数据库中。
`
}

export async function writeDailyReportMarkdown(
  input: SaveDailyReportInput,
  reportDirectory: string,
): Promise<string> {
  const normalizedDirectory = reportDirectory.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || '学习报告/日报'
  const path = `${normalizedDirectory}/${input.localDate}-学习日报.md`
  const directoryOptions = await getFilePathOptions(normalizedDirectory)
  const directoryExists = directoryOptions.baseDir
    ? await exists(directoryOptions.path, { baseDir: directoryOptions.baseDir })
    : await exists(directoryOptions.path)
  if (!directoryExists) {
    if (directoryOptions.baseDir) {
      await mkdir(directoryOptions.path, { baseDir: directoryOptions.baseDir, recursive: true })
    } else {
      await mkdir(directoryOptions.path, { recursive: true })
    }
  }
  const fileOptions = await getFilePathOptions(path)
  const markdown = buildDailyReportMarkdown(input)
  if (fileOptions.baseDir) {
    await writeTextFile(fileOptions.path, markdown, { baseDir: fileOptions.baseDir })
  } else {
    await writeTextFile(fileOptions.path, markdown)
  }
  return path
}

export async function writePeriodicReportMarkdown(
  report: Pick<PeriodicLearningReport, 'type' | 'periodStart' | 'periodEnd' | 'content'>,
  reportDirectory: string,
): Promise<string> {
  const dailyDirectory = reportDirectory.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || '学习报告/日报'
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
  if (fileOptions.baseDir) await writeTextFile(fileOptions.path, report.content, { baseDir: fileOptions.baseDir })
  else await writeTextFile(fileOptions.path, report.content)
  return path
}
