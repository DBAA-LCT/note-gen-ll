import { fetchAi } from '@/lib/ai'
import type {
  LearningKnowledgeItem,
} from '@/types/learning'

function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced || text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  if (!candidate.trim()) throw new Error('模型没有返回可解析的结构化草稿')
  return JSON.parse(candidate) as T
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
