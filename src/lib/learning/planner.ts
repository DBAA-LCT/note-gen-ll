import { diffLocalDays, localWeekday } from './date'
import { allocateWeightedMinutes } from './logic'
import type { LearningGoal, LearningSettings } from '@/types/learning'

export interface PlannedTaskDraft {
  goalId: string
  localDate: string
  title: string
  description: string
  completionCriteria: string
  plannedMinutes: number
  generationNote: string
  generationKey: string
  sortOrder: number
}

export function eligibleGoalsForDate(
  goals: LearningGoal[],
  date: string,
  fallbackWeeklyDays: number[],
): LearningGoal[] {
  const weekday = localWeekday(date)
  return goals.filter(goal => {
    if (goal.status !== 'active' && goal.status !== 'planned') return false
    if (goal.startDate > date || goal.endDate < date) return false
    const days = goal.weeklyDays.length ? goal.weeklyDays : fallbackWeeklyDays
    return days.includes(weekday)
  })
}

export function allocateLearningMinutes(
  goals: LearningGoal[],
  budgetMinutes: number,
): Map<string, number> {
  return allocateWeightedMinutes(goals, budgetMinutes)
}

export function planTasksForDate(
  goals: LearningGoal[],
  settings: LearningSettings,
  date: string,
): PlannedTaskDraft[] {
  const eligible = eligibleGoalsForDate(goals, date, settings.weeklyDays)
  const allocations = allocateLearningMinutes(eligible, settings.dailyStudyMinutes)

  return eligible
    .filter(goal => (allocations.get(goal.id) ?? 0) > 0)
    .map((goal, index) => {
    const plannedMinutes = allocations.get(goal.id) ?? 0
    const remainingDays = Math.max(1, diffLocalDays(date, goal.endDate) + 1)
    return {
      goalId: goal.id,
      localDate: date,
      title: goal.description.trim() || `推进「${goal.title}」`,
      description: goal.note.trim() || `围绕「${goal.title}」完成今天可以交付的一步，并记录结果。`,
      completionCriteria: `投入约 ${plannedMinutes} 分钟，形成可检查的学习结果或问题清单。`,
      plannedMinutes,
      generationNote: `按目标权重 ${goal.timeWeight} 分配；距截止日期还有 ${remainingDays} 天。`,
      generationKey: `local-v1:${goal.id}:${date}`,
      sortOrder: index,
    }
    })
}
