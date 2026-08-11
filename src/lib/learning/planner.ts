import { diffLocalDays, localWeekday } from './date'
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
  const budget = Math.max(15, Math.min(720, Math.round(budgetMinutes)))
  const result = new Map<string, number>()
  if (!goals.length) return result

  const totalWeight = goals.reduce((sum, goal) => sum + Math.max(1, goal.timeWeight), 0)
  const shares = goals.map(goal => {
    const exact = budget * Math.max(1, goal.timeWeight) / totalWeight
    return {
      goal,
      minutes: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    }
  })
  let remaining = budget - shares.reduce((sum, share) => sum + share.minutes, 0)
  shares
    .sort((left, right) => right.remainder - left.remainder || left.goal.createdAt - right.goal.createdAt)
    .forEach(share => {
      if (remaining > 0) {
        share.minutes += 1
        remaining -= 1
      }
    })
  shares.forEach(share => result.set(share.goal.id, share.minutes))
  return result
}

export function planTasksForDate(
  goals: LearningGoal[],
  settings: LearningSettings,
  date: string,
): PlannedTaskDraft[] {
  const eligible = eligibleGoalsForDate(goals, date, settings.weeklyDays)
  const allocations = allocateLearningMinutes(eligible, settings.dailyStudyMinutes)

  return eligible.map((goal, index) => {
    const plannedMinutes = allocations.get(goal.id) || 15
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
