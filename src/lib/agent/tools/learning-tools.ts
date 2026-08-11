import { formatLocalDate } from '@/lib/learning/date'
import {
  createLearningGoal,
  createManualLearningTask,
  listLearningDaySummaries,
  listLearningKnowledgeBases,
  listLearningKnowledgeItems,
  listLearningReviewStates,
  listLearningScheduleEvents,
  listLearningTasks,
  saveLearningScheduleEvent,
  setLearningTaskStatus,
} from '@/lib/learning/repository'
import useLearningStore from '@/stores/learning'
import type { AgentTool } from '../types'

const string = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const number = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback

const getLearningContextTool: AgentTool = {
  name: 'learning_get_context', title: '读取学习上下文', category: 'system', risk: 'read',
  description: 'Read NoteGen learning goals, tasks, schedule, review queue and recent progress. Use this before planning or adjusting learning work.',
  inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD; defaults to current learning date.' } }, additionalProperties: false },
  execute: async input => {
    const store = useLearningStore.getState(); const date = string(input.date) || store.date || formatLocalDate()
    const [tasks, events, summaries, bases, items, states] = await Promise.all([listLearningTasks(date), listLearningScheduleEvents(date, date), listLearningDaySummaries(date, date), listLearningKnowledgeBases(), listLearningKnowledgeItems(), listLearningReviewStates()])
    const stateMap = new Map(states.map(item => [item.itemId, item]))
    return { ok: true, message: `已读取 ${date} 的学习上下文。`, data: { date, goals: store.goals, tasks, events, summary: summaries[0] || null, review: { knowledgeBases: bases, totalItems: items.length, dueItems: items.filter(item => !stateMap.has(item.id) || stateMap.get(item.id)!.dueDate <= date).length } } }
  },
}

const createLearningGoalTool: AgentTool = {
  name: 'learning_create_goal', title: '创建学习目标', category: 'system', risk: 'medium',
  description: 'Create a structured learning goal after the user has approved the proposed title, outcome, dates and time weight.',
  inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, startDate: { type: 'string' }, endDate: { type: 'string' }, timeWeight: { type: 'number' }, note: { type: 'string' } }, required: ['title','description','startDate','endDate'], additionalProperties: false },
  execute: async input => {
    const store = useLearningStore.getState(); const title = string(input.title); if (!title) return { ok: false, message: '标题不能为空。', error: 'EMPTY_TITLE' }
    const goal = await createLearningGoal({ title, description: string(input.description), startDate: string(input.startDate), endDate: string(input.endDate), timeZone: store.settings.timeZone, weeklyDays: store.settings.weeklyDays, timeWeight: Math.max(1, Math.min(10, Math.round(number(input.timeWeight, 1)))), color: '#3b82f6', note: string(input.note) })
    await store.refreshGoals(); await store.ensureTasks(store.date)
    return { ok: true, message: `已创建学习目标“${goal.title}”。`, data: goal }
  },
}

const createLearningTaskTool: AgentTool = {
  name: 'learning_create_task', title: '创建学习任务', category: 'system', risk: 'medium',
  description: 'Add an executable task to a date, optionally linked to an existing learning goal or NoteGen note.',
  inputSchema: { type: 'object', properties: { date: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, plannedMinutes: { type: 'number' }, goalId: { type: 'string' }, notePath: { type: 'string' } }, required: ['date','title','plannedMinutes'], additionalProperties: false },
  execute: async input => {
    const value = await createManualLearningTask({ localDate: string(input.date), title: string(input.title), description: string(input.description), plannedMinutes: Math.max(5, Math.min(720, Math.round(number(input.plannedMinutes, 30)))), goalId: string(input.goalId) || null, notePath: string(input.notePath) || null })
    const store = useLearningStore.getState(); if (string(input.date) === store.date) await store.loadDate(store.date)
    return { ok: true, message: `已创建学习任务“${string(input.title)}”。`, data: value }
  },
}

const updateTaskStatusTool: AgentTool = {
  name: 'learning_update_task_status', title: '更新学习任务状态', category: 'system', risk: 'medium',
  description: 'Update a known learning task to todo, in-progress, done or cancelled.',
  inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, status: { type: 'string', enum: ['todo','in-progress','done','cancelled'] } }, required: ['taskId','status'], additionalProperties: false },
  execute: async input => { const taskId = string(input.taskId); const status = input.status as 'todo'|'in-progress'|'done'|'cancelled'; await setLearningTaskStatus(taskId, status); const store = useLearningStore.getState(); await store.loadDate(store.date); return { ok: true, message: '任务状态已更新。', data: { taskId, status } } },
}

const createScheduleTool: AgentTool = {
  name: 'learning_create_schedule', title: '创建学习日程', category: 'system', risk: 'medium',
  description: 'Create an ordinary schedule event or milestone after the user approves its date and time.',
  inputSchema: { type: 'object', properties: { title: { type: 'string' }, date: { type: 'string' }, startTime: { type: 'string' }, endTime: { type: 'string' }, allDay: { type: 'boolean' }, kind: { type: 'string', enum: ['schedule','milestone'] }, notes: { type: 'string' } }, required: ['title','date'], additionalProperties: false },
  execute: async input => { const allDay = Boolean(input.allDay); const event = await saveLearningScheduleEvent({ title: string(input.title), localDate: string(input.date), startTime: allDay ? null : string(input.startTime) || '09:00', endTime: allDay ? null : string(input.endTime) || '10:00', allDay, kind: input.kind === 'milestone' ? 'milestone' : 'schedule', notes: string(input.notes) }); return { ok: true, message: `已创建日程“${event.title}”。`, data: event } },
}

export const learningTools: AgentTool[] = [getLearningContextTool, createLearningGoalTool, createLearningTaskTool, updateTaskStatusTool, createScheduleTool]
