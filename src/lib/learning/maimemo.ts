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

async function describeMaimemoError(status: number, detail: string): Promise<Error> {
  let message = detail.slice(0, 160)
  try {
    const payload = JSON.parse(detail) as { errors?: Array<{ code?: string; msg?: string }> }
    const error = payload.errors?.[0]
    if (error?.msg || error?.code) message = [error.msg, error.code].filter(Boolean).join('（') + (error.msg && error.code ? '）' : '')
  } catch { /* Keep the response text when it is not JSON. */ }
  return new Error(`墨墨 API 请求失败（${status}）${message ? `：${message}` : ''}`)
}

type MaimemoEnvelope<T> = { data?: T; errors?: Array<{ code?: string; msg?: string }>; success?: boolean }
type NativeMaimemoResponse = { status: number; body: string }

async function maimemoRequest<T>(path: string, body?: Record<string, unknown>, token?: string, method?: 'GET' | 'POST'): Promise<T> {
  const accessToken = token?.trim() || await getMaimemoToken()
  if (!accessToken) throw new Error('尚未配置墨墨开放 API Token')

  const resolvedMethod = method || (body ? 'POST' : 'GET')
  let status: number
  let responseText: string
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const response = await invoke<NativeMaimemoResponse>('maimemo_request', {
      path,
      method: resolvedMethod,
      body: body || null,
      token: accessToken,
    })
    status = response.status
    responseText = response.body
  } else {
    const response = await globalThis.fetch(`${API_BASE}${path}`, {
      method: resolvedMethod,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: body ? JSON.stringify(body) : undefined,
    })
    status = response.status
    responseText = await response.text()
  }

  if (status < 200 || status >= 300) throw await describeMaimemoError(status, responseText)
  const payload = JSON.parse(responseText) as T & MaimemoEnvelope<T>
  if (payload && typeof payload === 'object' && payload.success === false) {
    throw await describeMaimemoError(status, responseText)
  }
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
