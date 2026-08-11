import { fetchAi } from '@/lib/ai'
import type {
  CreateLearningGoalInput,
  DailyReflection,
  DailyReportGoalEntry,
  LearningGoal,
  LearningTask,
  LearningKnowledgeItem,
} from '@/types/learning'

function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced || text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  if (!candidate.trim()) throw new Error('模型没有返回可解析的结构化草稿')
  return JSON.parse(candidate) as T
}

export async function createGoalDraftWithAi(
  request: string,
  context: { date: string; dailyMinutes: number; activeGoals: LearningGoal[] },
): Promise<Partial<CreateLearningGoalInput>> {
  const result = await fetchAi(`你是 NoteGen 的学习规划助手。请根据用户需求生成一个学习目标表单草稿。

当前日期：${context.date}
每日总学习预算：${context.dailyMinutes} 分钟
现有目标：${context.activeGoals.map(goal => `${goal.title}(${goal.startDate}~${goal.endDate})`).join('、') || '无'}
用户需求：${request}

只返回 JSON，不要 Markdown。字段如下：
{
  "title": "简短标题",
  "description": "明确、可验收的目标",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "timeWeight": 1到10的整数,
  "note": "执行建议、里程碑与风险提示"
}`)
  if (!result) throw new Error('当前没有可用的聊天模型')
  const draft = extractJson<Partial<CreateLearningGoalInput>>(result)
  if (draft.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate)) delete draft.startDate
  if (draft.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.endDate)) delete draft.endDate
  if (draft.timeWeight !== undefined) {
    draft.timeWeight = Math.max(1, Math.min(10, Math.round(Number(draft.timeWeight) || 1)))
  }
  return draft
}

export async function createDailyReviewDraftWithAi(input: {
  date: string
  tasks: LearningTask[]
  entries: DailyReportGoalEntry[]
}): Promise<{ overall: string; reflection: DailyReflection }> {
  const result = await fetchAi(`你是 NoteGen 的学习复盘助手。根据当天记录生成简洁、诚实的复盘草稿，不要虚构未提供的信息。

日期：${input.date}
任务：${input.tasks.map(task => `- [${task.status === 'done' ? 'x' : ' '}] ${task.title}`).join('\n') || '无'}
目标记录：${input.entries.map(entry => `- ${entry.goalTitle}：${entry.content || '未填写'}；进度 ${entry.progressPercent}%；学习 ${entry.studyMinutes} 分钟`).join('\n') || '无'}

只返回 JSON，不要 Markdown：
{
  "overall": "一句到三句总体总结",
  "reflection": {
    "energyLevel": 1到5或null,
    "focusLevel": 1到5或null,
    "biggestWin": "最大收获",
    "biggestBlocker": "主要困难",
    "nextIntention": "下次调整意图"
  }
}`)
  if (!result) throw new Error('当前没有可用的聊天模型')
  const draft = extractJson<{ overall?: string; reflection?: Partial<DailyReflection> }>(result)
  const normalizeLevel = (value: unknown) => {
    const number = Number(value)
    return Number.isFinite(number) ? Math.max(1, Math.min(5, Math.round(number))) : null
  }
  return {
    overall: String(draft.overall || ''),
    reflection: {
      energyLevel: normalizeLevel(draft.reflection?.energyLevel),
      focusLevel: normalizeLevel(draft.reflection?.focusLevel),
      biggestWin: String(draft.reflection?.biggestWin || ''),
      biggestBlocker: String(draft.reflection?.biggestBlocker || ''),
      nextIntention: String(draft.reflection?.nextIntention || ''),
    },
  }
}

export async function gradeLearningAnswerWithAi(input: {
  item: LearningKnowledgeItem
  answer: string
}): Promise<{ grade: 0 | 1 | 2 | 3; feedback: string }> {
  const result = await fetchAi(`你是 NoteGen 的学习测验评分助手。请严格根据参考答案判断用户回答，不要扩展题目范围。
题目：${input.item.prompt}
参考答案：${input.item.answer}
补充说明：${input.item.explanation || '无'}
用户回答：${input.answer}

只返回 JSON：{"grade":0到3的整数,"feedback":"一句简短、具体的中文反馈"}
评分：0=错误，1=少量相关但核心错误，2=核心正确但不完整，3=完整正确。`)
  if (!result) throw new Error('当前没有可用的聊天模型')
  const parsed = extractJson<{ grade?: number; feedback?: string }>(result)
  const grade = Math.max(0, Math.min(3, Math.round(Number(parsed.grade) || 0))) as 0 | 1 | 2 | 3
  return { grade, feedback: String(parsed.feedback || '') }
}
