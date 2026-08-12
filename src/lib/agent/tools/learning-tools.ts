import { addLocalDays, formatLocalDate } from '@/lib/learning/date'
import {
  createManualLearningTask,
  listLearningDaySummaries,
  listDailyReports,
  getPeriodicLearningReport,
  listLearningKnowledgeBases,
  listLearningKnowledgeItems,
  listLearningReviewStates,
  listLearningScheduleEvents,
  listLearningTasks,
  saveLearningScheduleEvent,
  setLearningTaskProgress,
  setLearningTaskStatus,
} from '@/lib/learning/repository'
import useLearningStore from '@/stores/learning'
import type { AgentTool } from '../types'
import { getLearningPeriodBounds } from '@/lib/learning/period-report'

const string = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const number = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback

const getLearningContextTool: AgentTool = {
  name: 'learning_get_context', title: '读取学习上下文', category: 'system', risk: 'read',
  description: 'Read NoteGen learning goals, tasks, schedule, review queue and recent progress. Use this before planning or adjusting learning work.',
  inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD; defaults to current learning date.' } }, additionalProperties: false },
  execute: async input => {
    const store = useLearningStore.getState(); const date = string(input.date) || store.date || formatLocalDate()
    const week = getLearningPeriodBounds('week', addLocalDays(date, -7)); const month = getLearningPeriodBounds('month', addLocalDays(date, -31))
    const [tasks, events, summaries, recentReports, weeklyReport, monthlyReport, bases, items, states] = await Promise.all([listLearningTasks(date), listLearningScheduleEvents(date, date), listLearningDaySummaries(date, date), listDailyReports(addLocalDays(date, -14), date), getPeriodicLearningReport('week', week.start, week.end), getPeriodicLearningReport('month', month.start, month.end), listLearningKnowledgeBases(), listLearningKnowledgeItems(), listLearningReviewStates()])
    const stateMap = new Map(states.map(item => [item.itemId, item]))
    return { ok: true, message: `已读取 ${date} 的学习上下文。`, data: { date, goals: store.goals, tasks, events, summary: summaries[0] || null, currentReport: recentReports.find(report => report.localDate === date) || null, recentCompletedReports: recentReports.filter(report => report.completedAt).slice(-7), periodicReports: { week: weeklyReport, month: monthlyReport }, review: { knowledgeBases: bases, totalItems: items.length, dueItems: items.filter(item => !stateMap.has(item.id) || stateMap.get(item.id)!.dueDate <= date).length } } }
  },
}

const askLearningInterviewQuestionTool: AgentTool = {
  name: 'learning_ask_interview_question', title: '提出学习访谈问题', category: 'system', risk: 'read',
  description: 'Ask exactly one atomic question in any NoteGoal learning interview, including goal creation, single-goal daily reports, and whole-day daily reports. You must use this tool for every interview turn and then wait for the user reply; never ask an interview question only in ordinary assistant text. Never put several questions, dimensions, numbered items, or a checklist into one call. Always provide 2-5 options. Use answerMode="direct" for closed questions with short mutually exclusive answers (such as direction, deadline, completion status, level or preference); clicking these answers immediately. Use answerMode="draft" for open questions that benefit from elaboration; each value must be a natural first-person draft that is inserted into the composer for editing and is not sent automatically. Keep free-text available. Remember facts already supplied in the conversation and never ask the user to repeat them. When enough information is available, stop interviewing and call the appropriate proposal tool: learning_propose_goal or learning_propose_daily_report.',
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'The one narrow fact being collected, for example deadline or Python experience.' },
      question: { type: 'string', description: 'One short, independently answerable question. Do not include subquestions or lists.' },
      answerMode: {
        type: 'string',
        enum: ['direct', 'draft'],
        description: 'direct submits a closed-choice answer immediately; draft fills the input for the user to edit before sending.',
      },
      options: {
        type: 'array',
        description: 'Provide 2-5 choices. In direct mode use short complete answers; in draft mode provide editable answer drafts.',
        minItems: 2,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Short button label.' },
            value: { type: 'string', description: 'The submitted answer in direct mode, or the editable first-person answer draft in draft mode.' },
            description: { type: 'string', description: 'Optional short clarification.' },
          },
          required: ['label', 'value'],
          additionalProperties: false,
        },
      },
      allowFreeText: { type: 'boolean', description: 'Normally true so the user can answer in their own words.' },
    },
    required: ['topic', 'question', 'answerMode', 'options'],
    additionalProperties: false,
  },
  execute: async input => {
    const topic = string(input.topic)
    const question = string(input.question)
    const questionMarkCount = (question.match(/[?？]/g) || []).length
    const hasList = /\n\s*(?:[-*•]|\d+[.)、])/u.test(question)
    if (!topic || !question || question.length > 180 || questionMarkCount > 1 || hasList) {
      return { ok: false, message: '每轮只能问一个简短、独立的问题；请拆分子问题后重试。', error: 'INTERVIEW_QUESTION_NOT_ATOMIC' }
    }
    const rawOptions = Array.isArray(input.options) ? input.options : []
    const options = rawOptions.slice(0, 5).map(value => value && typeof value === 'object' ? value as Record<string, unknown> : {}).map(option => ({
      label: string(option.label), value: string(option.value), description: string(option.description),
    })).filter(option => option.label && option.value)
    if (options.length < 2) {
      return { ok: false, message: '每个访谈问题都需要提供 2–5 个可编辑的回答草稿。', error: 'INTERVIEW_OPTIONS_REQUIRED' }
    }
    return {
      ok: true,
      message: '已向用户提出一个访谈问题，请等待回答后再继续。',
      data: { kind: 'learning-interview-question', topic, question, answerMode: input.answerMode === 'draft' ? 'draft' : 'direct', options, allowFreeText: input.allowFreeText !== false },
    }
  },
}

const proposeLearningGoalTool: AgentTool = {
  name: 'learning_propose_goal', title: '提出学习目标草案', category: 'system', risk: 'read',
  description: 'Propose a structured learning goal draft for the user to review, either for a new goal or an AI adjustment to an existing goal. This never creates or saves a goal. For an existing goal adjustment, preserve its targetGoalId in the proposal so adoption edits that goal instead of creating a duplicate. The app renders the result as a draft card with an adoption button; do not claim the goal was created or updated.',
  inputSchema: { type: 'object', properties: { targetGoalId: { type: 'string', description: 'Existing goal ID when adjusting a saved goal; omit for a new goal.' }, title: { type: 'string' }, description: { type: 'string' }, startDate: { type: 'string' }, endDate: { type: 'string' }, timeWeight: { type: 'number' }, note: { type: 'string' }, planMarkdown: { type: 'string', description: 'A concrete phased learning roadmap in Markdown. Include ordered stages, outcomes and suggested milestones.' } }, required: ['title','description','startDate','endDate','planMarkdown'], additionalProperties: false },
  execute: async input => {
    const title = string(input.title); const description = string(input.description); const startDate = string(input.startDate); const endDate = string(input.endDate)
    if (!title || !description) return { ok: false, message: '草案需要标题和可验收的目标。', error: 'INVALID_GOAL_DRAFT' }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) return { ok: false, message: '草案日期无效。', error: 'INVALID_GOAL_DATES' }
    const targetGoalId = string(input.targetGoalId)
    if (targetGoalId && !useLearningStore.getState().goals.some(goal => goal.id === targetGoalId)) return { ok: false, message: '要调整的学习目标不存在。', error: 'GOAL_NOT_FOUND' }
    const draft = { kind: 'learning-goal-draft', targetGoalId: targetGoalId || null, title, description, startDate, endDate, timeWeight: Math.max(1, Math.min(10, Math.round(number(input.timeWeight, 5)))), note: string(input.note), planMarkdown: string(input.planMarkdown) }
    return { ok: true, message: '学习目标草案已生成，等待用户采用。', data: draft }
  },
}

const proposeDailyPlanTool: AgentTool = {
  name: 'learning_propose_daily_plan', title: '提出每日学习计划', category: 'system', risk: 'read',
  description: 'Propose a daily task plan card without saving it. Before using this, call learning_get_context for the target date and use recent daily reports plus each goal roadmap. The tasks must be concrete, fit the daily time budget and belong to known active goals. The user must adopt the card before tasks are written.',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD' },
      basedOnDate: { type: 'string', description: 'Latest daily report date used as evidence, when any.' },
      rationale: { type: 'string', description: 'Short explanation of how report evidence and goal roadmaps shaped this plan.' },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            goalId: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
            completionCriteria: { type: 'string' }, plannedMinutes: { type: 'number' },
          },
          required: ['goalId','title','description','completionCriteria'],
          additionalProperties: false,
        },
      },
    },
    required: ['date','rationale','tasks'],
    additionalProperties: false,
  },
  execute: async input => {
    const date = string(input.date); const tasks = Array.isArray(input.tasks) ? input.tasks : []
    const activeIds = new Set(useLearningStore.getState().goals.filter(goal => goal.status === 'active' || goal.status === 'planned').map(goal => goal.id))
    const normalized = tasks.map(value => value && typeof value === 'object' ? value as Record<string, unknown> : {}).map(task => ({
      goalId: string(task.goalId), title: string(task.title), description: string(task.description), completionCriteria: string(task.completionCriteria), plannedMinutes: Math.max(0, Math.min(720, Math.round(number(task.plannedMinutes, 0)))),
    })).filter(task => activeIds.has(task.goalId) && task.title && task.completionCriteria)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || normalized.length === 0) return { ok: false, message: '每日计划草案无效。', error: 'INVALID_DAILY_PLAN' }
    return { ok: true, message: '每日学习计划草案已生成，等待用户采用。', data: { kind: 'learning-daily-plan-draft', date, basedOnDate: string(input.basedOnDate) || null, rationale: string(input.rationale), tasks: normalized } }
  },
}

const proposeDailyReportTool: AgentTool = {
  name: 'learning_propose_daily_report', title: '提出规划日报草案', category: 'system', risk: 'read',
  description: 'Propose all or part of one date’s daily report after interviewing the user. Never save it. For a single-goal interview include exactly that goal entry; for a whole-day interview include every discussed goal. Existing entries for the same date will be merged by goal when the user adopts the card.',
  inputSchema: {
    type: 'object', properties: {
      date: { type: 'string' }, scope: { type: 'string', enum: ['single-goal','whole-day'] }, overall: { type: 'string' },
      energyLevel: { type: 'number' }, focusLevel: { type: 'number' }, biggestWin: { type: 'string' }, biggestBlocker: { type: 'string' }, nextIntention: { type: 'string' },
      entries: { type: 'array', items: { type: 'object', properties: {
        goalId: { type: 'string' }, goalTitle: { type: 'string' }, status: { type: 'string', enum: ['done','partial','not-done'] }, progressPercent: { type: 'number' }, studyMinutes: { type: 'number' }, content: { type: 'string' },
      }, required: ['goalId','goalTitle','status','progressPercent','studyMinutes','content'], additionalProperties: false } },
    }, required: ['date','scope','entries'], additionalProperties: false,
  },
  execute: async input => {
    const date = string(input.date); const values = Array.isArray(input.entries) ? input.entries : []
    const entries = values.map(value => value && typeof value === 'object' ? value as Record<string, unknown> : {}).map(entry => ({
      goalId: string(entry.goalId), goalTitle: string(entry.goalTitle), status: entry.status === 'done' || entry.status === 'partial' ? entry.status : 'not-done', progressPercent: Math.max(0, Math.min(100, number(entry.progressPercent, 0))), studyMinutes: Math.max(0, Math.round(number(entry.studyMinutes, 0))), content: string(entry.content),
    })).filter(entry => entry.goalId && entry.goalTitle)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || entries.length === 0) return { ok: false, message: '日报草案无效。', error: 'INVALID_DAILY_REPORT' }
    return { ok: true, message: '规划日报草案已生成，等待用户采用。', data: { kind: 'learning-daily-report-draft', date, scope: input.scope === 'single-goal' ? 'single-goal' : 'whole-day', overall: string(input.overall), reflection: { energyLevel: input.energyLevel == null ? null : Math.max(1, Math.min(5, Math.round(number(input.energyLevel, 3)))), focusLevel: input.focusLevel == null ? null : Math.max(1, Math.min(5, Math.round(number(input.focusLevel, 3)))), biggestWin: string(input.biggestWin), biggestBlocker: string(input.biggestBlocker), nextIntention: string(input.nextIntention) }, entries } }
  },
}

const createLearningTaskTool: AgentTool = {
  name: 'learning_create_task', title: '创建学习任务', category: 'system', risk: 'medium',
  description: 'Add an executable task to a date, optionally linked to an existing learning goal or NoteGen note.',
  inputSchema: { type: 'object', properties: { date: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, plannedMinutes: { type: 'number', description: 'Optional rough estimate in minutes.' }, goalId: { type: 'string' }, notePath: { type: 'string' } }, required: ['date','title'], additionalProperties: false },
  execute: async input => {
    const value = await createManualLearningTask({ localDate: string(input.date), title: string(input.title), description: string(input.description), plannedMinutes: Math.max(0, Math.min(720, Math.round(number(input.plannedMinutes, 0)))), goalId: string(input.goalId) || null, notePath: string(input.notePath) || null })
    const store = useLearningStore.getState(); if (string(input.date) === store.date) await store.loadDate(store.date)
    return { ok: true, message: `已创建学习任务“${string(input.title)}”。`, data: value }
  },
}

const updateTaskStatusTool: AgentTool = {
  name: 'learning_update_task_status', title: '更新学习任务状态', category: 'system', risk: 'medium',
  description: 'Update a known task progress from 0 to 100, or set an explicit status. Progress is preferred; 100 means done.',
  inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, progressPercent: { type: 'number', minimum: 0, maximum: 100 }, status: { type: 'string', enum: ['todo','in-progress','done','cancelled'] } }, required: ['taskId'], additionalProperties: false },
  execute: async input => { const taskId = string(input.taskId); if (input.progressPercent != null) await setLearningTaskProgress(taskId, number(input.progressPercent, 0)); else { const status = input.status as 'todo'|'in-progress'|'done'|'cancelled'; await setLearningTaskStatus(taskId, status || 'todo') } const store = useLearningStore.getState(); await store.loadDate(store.date); return { ok: true, message: '任务进度已更新。', data: { taskId, progressPercent: input.progressPercent ?? null, status: input.status ?? null } } },
}

const createScheduleTool: AgentTool = {
  name: 'learning_create_schedule', title: '创建学习日程', category: 'system', risk: 'medium',
  description: 'Create an ordinary schedule event or milestone after the user approves its date and time.',
  inputSchema: { type: 'object', properties: { title: { type: 'string' }, date: { type: 'string' }, startTime: { type: 'string' }, endTime: { type: 'string' }, allDay: { type: 'boolean' }, kind: { type: 'string', enum: ['schedule','milestone'] }, notes: { type: 'string' } }, required: ['title','date'], additionalProperties: false },
  execute: async input => { const allDay = Boolean(input.allDay); const event = await saveLearningScheduleEvent({ title: string(input.title), localDate: string(input.date), startTime: allDay ? null : string(input.startTime) || '09:00', endTime: allDay ? null : string(input.endTime) || '10:00', allDay, kind: input.kind === 'milestone' ? 'milestone' : 'schedule', notes: string(input.notes) }); return { ok: true, message: `已创建日程“${event.title}”。`, data: event } },
}

export const learningTools: AgentTool[] = [getLearningContextTool, askLearningInterviewQuestionTool, proposeLearningGoalTool, proposeDailyPlanTool, proposeDailyReportTool, createLearningTaskTool, updateTaskStatusTool, createScheduleTool]
