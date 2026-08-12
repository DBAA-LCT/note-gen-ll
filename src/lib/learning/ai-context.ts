import { listLearningKnowledgeBases, listLearningKnowledgeItems, listLearningReviewStates, listLearningScheduleEvents } from './repository'
import useLearningStore from '@/stores/learning'

export async function buildLearningWorkspaceContext(): Promise<string> {
  const state = useLearningStore.getState()
  const date = state.date
  const [events, bases, items, reviewStates] = await Promise.all([
    date ? listLearningScheduleEvents(date, date) : Promise.resolve([]),
    listLearningKnowledgeBases(), listLearningKnowledgeItems(), listLearningReviewStates(),
  ])
  const reviewMap = new Map(reviewStates.map(item => [item.itemId, item]))
  const dueItems = date ? items.filter(item => !reviewMap.has(item.id) || reviewMap.get(item.id)!.dueDate <= date).length : 0
  return [
    '## 当前学习中心上下文',
    `日期：${date}`,
    `目标：${state.goals.map(goal => `${goal.title}（${Math.round(goal.progressPercent)}%，${goal.status}）`).join('；') || '无'}`,
    `今日任务：${state.tasks.map(task => `${task.title}[进度${Math.round(task.progressPercent)}%, ${task.status}${task.plannedMinutes > 0 ? `, 预计${task.plannedMinutes}分钟` : ''}, id=${task.id}]`).join('；') || '无'}`,
    `今日日程：${events.map(event => `${event.title}[${event.allDay ? '全天' : event.startTime}, id=${event.id}]`).join('；') || '无'}`,
    `知识复习：${bases.length} 个知识库，${items.length} 个条目，${dueItems} 个待复习。`,
    '需要读取最新结构化数据时使用 learning_get_context。修改目标、任务或日程时先说明建议，再使用 learning_* 工具并等待用户确认。',
    '',
  ].join('\n')
}
