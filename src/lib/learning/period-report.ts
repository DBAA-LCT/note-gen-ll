import { listDailyReports, listLearningDaySummaries } from '@/lib/learning/repository'
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

export async function generateLocalPeriodicReport(
  type: PeriodicLearningReportType,
  periodStart: string,
  periodEnd: string,
): Promise<Omit<PeriodicLearningReport, 'id' | 'createdAt' | 'updatedAt'>> {
  const [summaries, reports] = await Promise.all([
    listLearningDaySummaries(periodStart, periodEnd),
    listDailyReports(periodStart, periodEnd),
  ])
  const metrics = summaries.reduce((result, summary) => ({
    focusedMinutes: result.focusedMinutes + summary.focusedMinutes,
    taskTotal: result.taskTotal + summary.taskTotal,
    taskDone: result.taskDone + summary.taskDone,
    studyDays: result.studyDays + Number(summary.focusedMinutes > 0 || summary.taskDone > 0 || summary.hasReport),
    reportDays: result.reportDays + Number(summary.hasReport),
  }), { focusedMinutes: 0, taskTotal: 0, taskDone: 0, studyDays: 0, reportDays: 0 })
  const completionRate = metrics.taskTotal ? Math.round(metrics.taskDone / metrics.taskTotal * 100) : 0
  const label = type === 'week' ? '学习周报' : '学习月报'
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
    ...(daily.length ? daily : ['该周期还没有已提交的学习日报。']),
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
