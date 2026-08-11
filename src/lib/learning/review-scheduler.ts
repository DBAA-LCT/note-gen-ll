import { addLocalDays } from './date'
import type { LearningKnowledgeItem, LearningReviewAttempt, LearningReviewSettings, LearningReviewState } from '@/types/learning'

function hash(value: string) {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

export function parseLearningItems(text: string, type: LearningKnowledgeItem['type']) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => {
    const separator = line.includes('\t') ? '\t' : line.includes('|') ? '|' : ','
    const [prompt = '', answer = '', aliases = '', tags = '', explanation = ''] = line.split(separator).map(value => value.trim())
    return {
      type,
      prompt,
      answer,
      aliases: aliases.split('/').map(value => value.trim()).filter(Boolean),
      tags: tags.split('/').map(value => value.trim()).filter(Boolean),
      explanation,
    }
  }).filter(item => item.prompt && item.answer)
}

export function selectReviewItems(input: {
  date: string
  items: LearningKnowledgeItem[]
  states: LearningReviewState[]
  attempts: LearningReviewAttempt[]
  settings: LearningReviewSettings
}) {
  if (!input.settings.enabled) return []
  const baseIds = new Set(input.settings.knowledgeBaseIds)
  const types = new Set(input.settings.itemTypes)
  const reviewed = new Set(input.attempts.filter(item => item.localDate === input.date).map(item => item.itemId))
  const stateMap = new Map(input.states.map(item => [item.itemId, item]))
  const eligible = input.items.filter(item => !reviewed.has(item.id) && types.has(item.type) && (!baseIds.size || baseIds.has(item.knowledgeBaseId)))
  const stable = (rows: LearningKnowledgeItem[]) => [...rows].sort((a, b) => hash(`${input.date}:${a.id}`) - hash(`${input.date}:${b.id}`))
  const due = stable(eligible.filter(item => stateMap.get(item.id)?.dueDate && stateMap.get(item.id)!.dueDate <= input.date))
    .sort((a, b) => stateMap.get(a.id)!.dueDate.localeCompare(stateMap.get(b.id)!.dueDate))
  const weak = stable(eligible.filter(item => {
    const state = stateMap.get(item.id)
    return state && state.dueDate > input.date && state.mastery < 60
  })).sort((a, b) => stateMap.get(a.id)!.mastery - stateMap.get(b.id)!.mastery)
  const fresh = stable(eligible.filter(item => !stateMap.has(item.id)))
  const count = Math.min(50, Math.max(1, Math.round(input.settings.dailyCount)))
  return [...due, ...weak, ...fresh, ...stable(eligible)].filter((item, index, rows) => rows.findIndex(row => row.id === item.id) === index).slice(0, count)
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\\(?:left|right|mathrm|text|operatorname)/g, '').replace(/[\s`~!@#$%^&*()_+={}\[\]:;"'，。！？、；：“”‘’（）【】]/g, '').replace(/±/g, '+-')
}

export function deterministicGrade(item: Pick<LearningKnowledgeItem, 'answer' | 'aliases'>, answer: string): 3 | null {
  const candidate = normalize(answer)
  if (!candidate) return null
  return [item.answer, ...item.aliases].some(value => normalize(value) === candidate) ? 3 : null
}

export function scheduleReview(previous: LearningReviewState | undefined, itemId: string, date: string, grade: 0 | 1 | 2 | 3): LearningReviewState {
  const base = previous || { itemId, dueDate: date, intervalDays: 0, easeFactor: 2.3, repetitions: 0, mastery: 0, lastReviewedAt: null }
  let repetitions = base.repetitions
  let intervalDays = base.intervalDays
  let easeFactor = base.easeFactor
  if (grade === 0) { repetitions = 0; intervalDays = 1; easeFactor = Math.max(1.3, easeFactor - 0.25) }
  else if (grade === 1) { repetitions = 0; intervalDays = 2; easeFactor = Math.max(1.3, easeFactor - 0.12) }
  else {
    repetitions += 1
    intervalDays = repetitions === 1 ? (grade === 3 ? 3 : 1) : repetitions === 2 ? (grade === 3 ? 7 : 3) : Math.max(1, Math.round(Math.max(1, intervalDays) * easeFactor))
    easeFactor = Math.min(3, easeFactor + (grade === 3 ? 0.08 : 0))
  }
  return { ...base, dueDate: addLocalDays(date, intervalDays), intervalDays, easeFactor, repetitions, mastery: Math.max(0, Math.min(100, base.mastery + [-18, -8, 10, 18][grade])), lastReviewedAt: Date.now() }
}
