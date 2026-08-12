import { getPeriodicLearningReport, listDailyReportsForSummary, listLearningDaySummaries, listPeriodicLearningReports } from '@/lib/learning/repository'
import type { PeriodicLearningReport, PeriodicLearningReportType } from '@/types/learning'

function dateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function getLearningPeriodBounds(type: PeriodicLearningReportType, anchor: string) {
  const date = new Date(`${anchor}T12:00:00`)
  if (type === 'month') {
    return {
      start: dateString(new Date(date.getFullYear(), date.getMonth(), 1)),
      end: dateString(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
    }
  }
  const weekday = (date.getDay() + 6) % 7
  const start = new Date(date)
  start.setDate(date.getDate() - weekday)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { start: dateString(start), end: dateString(end) }
}

export function shiftLearningPeriod(type: PeriodicLearningReportType, anchor: string, offset: number) {
  const date = new Date(`${anchor}T12:00:00`)
  if (type === 'month') date.setMonth(date.getMonth() + offset)
  else date.setDate(date.getDate() + offset * 7)
  return dateString(date)
}

function extractReportSection(content: string, heading: string): string[] {
  const lines = content.split('\n')
  const start = lines.findIndex(line => line.trim() === `## ${heading}`)
  if (start < 0) return []
  const result: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break
    if (line.trim()) result.push(line)
  }
  return result
}

async function generateMonthlyReportFromWeeks(
  periodStart: string,
  periodEnd: string,
): Promise<Omit<PeriodicLearningReport, 'id' | 'createdAt' | 'updatedAt'>> {
  const weeklyReports = await listPeriodicLearningReports('week', periodStart, periodEnd)
  if (!weeklyReports.length) {
    throw new Error('这个月还没有可汇总的规划周报，请先生成周报。')
  }

  const metrics = weeklyReports.reduce((result, report) => ({
    focusedMinutes: result.focusedMinutes + report.metrics.focusedMinutes,
    taskTotal: result.taskTotal + report.metrics.taskTotal,
    taskDone: result.taskDone + report.metrics.taskDone,
    studyDays: result.studyDays + report.metrics.studyDays,
    reportDays: result.reportDays + report.metrics.reportDays,
  }), { focusedMinutes: 0, taskTotal: 0, taskDone: 0, studyDays: 0, reportDays: 0 })
  const completionRate = metrics.taskTotal ? Math.round(metrics.taskDone / metrics.taskTotal * 100) : 0
  const title = `${periodStart} 至 ${periodEnd} 规划月报`
  const weeklySummary = weeklyReports.map(report => [
    `### ${report.periodStart} 至 ${report.periodEnd}`,
    `- 执行 ${report.metrics.studyDays} 天，任务 ${report.metrics.taskDone}/${report.metrics.taskTotal}`,
    `- 专注 ${Math.floor(report.metrics.focusedMinutes / 60)} 小时 ${report.metrics.focusedMinutes % 60} 分钟`,
  ].join('\n'))
  const highlights = weeklyReports.flatMap(report => extractReportSection(report.content, '主要收获'))
  const blockers = weeklyReports.flatMap(report => extractReportSection(report.content, '困难与阻碍'))
  const intentions = weeklyReports.flatMap(report => extractReportSection(report.content, '下一阶段意图'))
  const content = [
    `# ${title}`,
    '',
    '## 数据概览',
    `- 周报来源：${weeklyReports.length} 篇`,
    `- 执行天数：${metrics.studyDays} 天`,
    `- 专注时长：${Math.floor(metrics.focusedMinutes / 60)} 小时 ${metrics.focusedMinutes % 60} 分钟`,
    `- 任务完成：${metrics.taskDone}/${metrics.taskTotal}（${completionRate}%）`,
    '',
    '## 每周摘要',
    ...weeklySummary,
    '',
    '## 主要收获',
    ...(highlights.length ? highlights : ['- 暂无已记录的主要收获。']),
    '',
    '## 困难与阻碍',
    ...(blockers.length ? blockers : ['- 暂无已记录的困难。']),
    '',
    '## 下一阶段意图',
    ...(intentions.length ? intentions : ['- 暂无已记录的调整意图。']),
  ].join('\n')

  return {
    type: 'month',
    periodStart,
    periodEnd,
    title,
    content,
    metrics,
    sourceDates: weeklyReports.map(report => report.periodEnd),
  }
}

export async function generateLocalPeriodicReport(
  type: PeriodicLearningReportType,
  periodStart: string,
  periodEnd: string,
): Promise<Omit<PeriodicLearningReport, 'id' | 'createdAt' | 'updatedAt'>> {
  if (type === 'month') return generateMonthlyReportFromWeeks(periodStart, periodEnd)

  const [summaries, allReports] = await Promise.all([
    listLearningDaySummaries(periodStart, periodEnd),
    listDailyReportsForSummary(periodStart, periodEnd),
  ])
  const reports = allReports.filter(report => report.completedAt)
  const existingWeeklyReport = await getPeriodicLearningReport('week', periodStart, periodEnd)
  const availableDates = new Set(reports.map(report => report.localDate))
  const permanentlyDeletedSources = existingWeeklyReport?.sourceDates.filter(date => !availableDates.has(date)) || []
  if (permanentlyDeletedSources.length) {
    throw new Error(`该周报包含已永久删除的日报（${permanentlyDeletedSources.join('、')}），为避免丢失已汇总内容，不能重新生成。`)
  }
  const reportDates = new Set(reports.map(report => report.localDate))
  const metrics = summaries.reduce((result, summary) => ({
    focusedMinutes: result.focusedMinutes + summary.focusedMinutes,
    taskTotal: result.taskTotal + summary.taskTotal,
    taskDone: result.taskDone + summary.taskDone,
    studyDays: result.studyDays + Number(summary.focusedMinutes > 0 || summary.taskDone > 0 || summary.hasReport || reportDates.has(summary.localDate)),
    reportDays: result.reportDays,
  }), { focusedMinutes: 0, taskTotal: 0, taskDone: 0, studyDays: 0, reportDays: 0 })
  metrics.studyDays = new Set([
    ...summaries.filter(summary => summary.focusedMinutes > 0 || summary.taskDone > 0 || summary.hasReport).map(summary => summary.localDate),
    ...reportDates,
  ]).size
  metrics.reportDays = reports.length
  const completionRate = metrics.taskTotal ? Math.round(metrics.taskDone / metrics.taskTotal * 100) : 0
  const label = type === 'week' ? '规划周报' : '规划月报'
  const highlights = reports.flatMap(report => report.reflection.biggestWin ? [`- ${report.localDate}：${report.reflection.biggestWin}`] : [])
  const blockers = reports.flatMap(report => report.reflection.biggestBlocker ? [`- ${report.localDate}：${report.reflection.biggestBlocker}`] : [])
  const intentions = reports.flatMap(report => report.reflection.nextIntention ? [`- ${report.localDate}：${report.reflection.nextIntention}`] : [])
  const daily = reports.map(report => [
    `### ${report.localDate}`,
    report.overall || '当日未填写总体总结。',
    ...report.entries.filter(entry => entry.content).map(entry => `- **${entry.goalTitle}**：${entry.content}`),
  ].join('\n'))
  const title = `${periodStart} 至 ${periodEnd} ${label}`
  const content = [
    `# ${title}`,
    '',
    '## 数据概览',
    `- 学习天数：${metrics.studyDays} 天`,
    `- 专注时长：${Math.floor(metrics.focusedMinutes / 60)} 小时 ${metrics.focusedMinutes % 60} 分钟`,
    `- 任务完成：${metrics.taskDone}/${metrics.taskTotal}（${completionRate}%）`,
    `- 日报来源：${metrics.reportDays} 天`,
    '',
    '## 主要收获',
    ...(highlights.length ? highlights : ['- 暂无已记录的主要收获。']),
    '',
    '## 困难与阻碍',
    ...(blockers.length ? blockers : ['- 暂无已记录的困难。']),
    '',
    '## 下一阶段意图',
    ...(intentions.length ? intentions : ['- 暂无已记录的调整意图。']),
    '',
    '## 每日摘要',
    ...(daily.length ? daily : ['该周期还没有已提交的规划日报。']),
  ].join('\n')
  return {
    type,
    periodStart,
    periodEnd,
    title,
    content,
    metrics,
    sourceDates: reports.map(report => report.localDate),
  }
}
