import { isTauriRuntime } from '@/lib/check'

const STORE_FILE = 'store.json'
const TOKEN_KEY = 'learning.maimemo.accessToken'
const API_BASE = 'https://open.maimemo.com/open'

export interface MaimemoStudyProgress {
  finished: number
  total: number
  study_time: number
}

export interface MaimemoTodayItem {
  voc_id: string
  voc_spelling: string
  order: number
  is_new: boolean
  is_finished: boolean
}

export interface MaimemoNotepad { id: string; title: string; brief?: string; tags?: string[] }
export interface MarkjiDeck { id: string; name: string; description?: string; card_count: number; chapter_count: number }
export interface MarkjiCard { id: string; content: string }

async function getStore() {
  if (!isTauriRuntime()) return null
  const { Store } = await import('@tauri-apps/plugin-store')
  return Store.load(STORE_FILE)
}

export async function getMaimemoToken(): Promise<string> {
  const store = await getStore()
  if (store) return (await store.get<string>(TOKEN_KEY))?.trim() || ''
  return typeof window === 'undefined' ? '' : window.localStorage.getItem(TOKEN_KEY)?.trim() || ''
}

export async function saveMaimemoToken(token: string): Promise<void> {
  const store = await getStore()
  if (store) {
    if (token.trim()) await store.set(TOKEN_KEY, token.trim())
    else await store.delete(TOKEN_KEY)
    await store.save()
    return
  }
  if (typeof window === 'undefined') return
  if (token.trim()) window.localStorage.setItem(TOKEN_KEY, token.trim())
  else window.localStorage.removeItem(TOKEN_KEY)
}

async function maimemoRequest<T>(path: string, body?: Record<string, unknown>, token?: string, method?: 'GET' | 'POST'): Promise<T> {
  const accessToken = token?.trim() || await getMaimemoToken()
  if (!accessToken) throw new Error('尚未配置墨墨开放 API Token')
  const request = isTauriRuntime()
    ? (await import('@tauri-apps/plugin-http')).fetch
    : globalThis.fetch
  const response = await request(`${API_BASE}${path}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`墨墨 API 请求失败（${response.status}）${detail ? `：${detail.slice(0, 160)}` : ''}`)
  }
  const payload = await response.json() as T & { data?: T }
  return payload && typeof payload === 'object' && payload.data ? payload.data : payload
}

export async function getMaimemoStudyProgress(token?: string): Promise<MaimemoStudyProgress> {
  const result = await maimemoRequest<{ progress: MaimemoStudyProgress }>('/api/v1/memo/study/get_study_progress', {}, token)
  return result.progress
}

export async function getMaimemoTodayItems(options: { isFinished?: boolean; isNew?: boolean; limit?: number } = {}): Promise<MaimemoTodayItem[]> {
  const body: Record<string, unknown> = { limit: Math.max(1, Math.min(1000, options.limit || 50)) }
  if (options.isFinished !== undefined) body.is_finished = options.isFinished
  if (options.isNew !== undefined) body.is_new = options.isNew
  const result = await maimemoRequest<{ today_items: MaimemoTodayItem[] }>('/api/v1/memo/study/get_today_items', body)
  return result.today_items
}

export async function listMaimemoNotepads(): Promise<MaimemoNotepad[]> {
  const rows: MaimemoNotepad[] = []
  for (let offset = 0; offset < 100; offset += 10) {
    const result = await maimemoRequest<{ notepads: MaimemoNotepad[] }>(`/api/v1/memo/notepads?limit=10&offset=${offset}`)
    const page = result.notepads || []
    rows.push(...page)
    if (page.length < 10) break
  }
  return rows
}

export async function listMarkjiDecks(): Promise<MarkjiDeck[]> {
  const rows: MarkjiDeck[] = []
  for (let offset = 0; offset < 100; offset += 10) {
    const result = await maimemoRequest<{ decks: MarkjiDeck[] }>(`/api/v1/markji/decks?limit=10&offset=${offset}`)
    const page = result.decks || []
    rows.push(...page)
    if (page.length < 10) break
  }
  return rows
}

export async function getMarkjiDeckCards(deckId: string): Promise<MarkjiCard[]> {
  const result = await maimemoRequest<{ cards?: MarkjiCard[] }>(`/api/v1/markji/decks/${encodeURIComponent(deckId)}/chapters?with_cards=true`)
  return result.cards || []
}
