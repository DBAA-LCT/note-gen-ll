import { locale as getSystemLocale } from '@tauri-apps/plugin-os'

import type { AiConfig } from '@/app/core/setting/config'

const OPENAI_TEMPLATE_KEYS = new Set(['chatgpt', 'openai'])

export function isBuiltInOpenAIProvider(config: AiConfig): boolean {
  if (config.templateSource === 'custom') return false

  const templateKey = (config.templateKey || config.key).trim().toLowerCase()
  if (OPENAI_TEMPLATE_KEYS.has(templateKey)) return true

  try {
    const hostname = new URL(config.baseURL || '').hostname.toLowerCase()
    return hostname === 'openai.com' || hostname.endsWith('.openai.com')
  } catch {
    return false
  }
}

export function excludeBuiltInOpenAIProviders(configs: AiConfig[]): AiConfig[] {
  return configs.filter(config => !isBuiltInOpenAIProvider(config))
}

export async function isMainlandChinaRegion(): Promise<boolean> {
  try {
    const systemLocale = await getSystemLocale()
    return /(?:^|[-_])CN$/i.test(systemLocale || '')
  } catch (error) {
    console.warn('[provider-region-policy] failed to read system locale', error)
    return false
  }
}
