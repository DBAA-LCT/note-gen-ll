import { Store } from '@tauri-apps/plugin-store'

import type { AiConfig } from '@/app/core/setting/config'
import { fetchConfigCenterConfig } from '@/lib/config-center/client'
import type { ConfigCenterConfigKey } from '@/lib/config-center/types'
import {
  excludeBuiltInOpenAIProviders,
  isMainlandChinaRegion,
} from '@/lib/ai/provider-region-policy'

export const PROVIDER_TEMPLATE_CACHE_KEY = 'providerTemplatesCache'
export const REMOVED_PROVIDER_TEMPLATE_KEYS = new Set([
  '302',
  'gitee',
  'lmstudio',
  'openrouter',
  'qiniu',
  'shengsuanyun',
  'siliconflow',
  'ucloud',
])

export function isRemovedProviderTemplate(config: Pick<AiConfig, 'key' | 'templateKey' | 'templateSource'>) {
  if (config.templateSource === 'custom') return false
  return REMOVED_PROVIDER_TEMPLATE_KEYS.has((config.templateKey || config.key).trim().toLowerCase())
}

export interface ProviderTemplateCache {
  configKey?: ConfigCenterConfigKey
  versionCode?: number
  versionName?: string
  fetchedAt: string
  content: {
    providers: unknown[]
  }
}

function mapBuiltinTemplates(templates: AiConfig[]): AiConfig[] {
  return templates.map((template) => ({
    ...template,
    templateKey: template.templateKey || template.key,
    templateSource: 'builtin' as const,
  }))
}

function mergeProviderTemplates(primary: AiConfig[], fallback: AiConfig[]): AiConfig[] {
  const merged = [...primary]
  const templateKeys = new Set(primary.map(template => template.templateKey || template.key))
  const baseURLs = new Set(primary.map(template => template.baseURL).filter(Boolean))

  for (const template of fallback) {
    const templateKey = template.templateKey || template.key
    if (templateKeys.has(templateKey) || (template.baseURL && baseURLs.has(template.baseURL))) {
      continue
    }

    merged.push(template)
    templateKeys.add(templateKey)
    if (template.baseURL) baseURLs.add(template.baseURL)
  }

  return merged
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isValidUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false
  }

  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function parseContentPayload(payload: unknown) {
  if (!payload) {
    return null
  }

  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload)
    } catch {
      return null
    }
  }

  if (typeof payload === 'object') {
    return payload
  }

  return null
}

function normalizeProviderTemplatesPayload(payload: unknown): AiConfig[] {
  const parsedPayload = parseContentPayload(payload)
  const providers = Array.isArray((parsedPayload as { providers?: unknown[] } | null)?.providers)
    ? (parsedPayload as { providers: unknown[] }).providers
    : []

  return providers
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .filter((item) => item.enabled !== false)
    .filter((item) => isNonEmptyString(item.key))
    .filter((item) => !REMOVED_PROVIDER_TEMPLATE_KEYS.has(String(item.key).trim().toLowerCase()))
    .filter((item) => isNonEmptyString(item.title))
    .filter((item) => isValidUrl(item.baseURL))
    .map((item) => ({
      key: String(item.key).trim(),
      title: String(item.title).trim(),
      baseURL: String(item.baseURL).trim(),
      icon: isNonEmptyString(item.icon) ? item.icon.trim() : undefined,
      apiKeyUrl: isValidUrl(item.apiKeyUrl) ? item.apiKeyUrl.trim() : undefined,
      enabled: true,
      templateSource: (item.templateSource as AiConfig['templateSource']) || 'remote',
    }))
}

function matchProviderTemplate({
  currentConfig,
  templates,
}: {
  currentConfig: AiConfig | undefined
  templates: AiConfig[]
}) {
  if (!currentConfig || templates.length === 0) {
    return null
  }

  if (isNonEmptyString(currentConfig.templateKey)) {
    const matchedByKey = templates.find((item) => item.key === currentConfig.templateKey)
    if (matchedByKey) {
      return matchedByKey
    }
  }

  if (isValidUrl(currentConfig.baseURL)) {
    const matchedByBaseUrl = templates.find((item) => item.baseURL === currentConfig.baseURL)
    if (matchedByBaseUrl) {
      return matchedByBaseUrl
    }
  }

  return null
}

function mapRemoteTemplates(content: ProviderTemplateCache['content'] | undefined): AiConfig[] {
  const templates = normalizeProviderTemplatesPayload(content)

  return templates.map((template: AiConfig) => ({
    ...template,
    templateKey: template.key,
    templateSource: 'remote' as const,
  }))
}

function enforceStorefrontPolicy(
  templates: AiConfig[],
  configKey: ConfigCenterConfigKey,
): AiConfig[] {
  return configKey === 'providerTemplatesChina'
    ? excludeBuiltInOpenAIProviders(templates)
    : templates
}

export async function getCachedProviderTemplates(builtinTemplates: AiConfig[] = []): Promise<AiConfig[]> {
  const store = await Store.load('store.json')
  const cached = await store.get<ProviderTemplateCache>(PROVIDER_TEMPLATE_CACHE_KEY)
  const configKey = await getProviderTemplateConfigKey()

  if (!cached || cached.configKey !== configKey || !cached.content?.providers?.length) {
    return []
  }

  return enforceStorefrontPolicy(mergeProviderTemplates(
    mapRemoteTemplates(cached.content),
    mapBuiltinTemplates(builtinTemplates),
  ), configKey)
}

async function getProviderTemplateConfigKey(): Promise<ConfigCenterConfigKey> {
  return await isMainlandChinaRegion()
    ? 'providerTemplatesChina'
    : 'providerTemplates'
}

async function fetchProviderTemplatesFromConfigCenter(
  configKey: ConfigCenterConfigKey,
  versionCode?: number | null,
): Promise<ProviderTemplateCache | null> {
  const result = await fetchConfigCenterConfig(configKey, versionCode)
  if (result.status === 'not-modified') {
    return null
  }

  const templates = enforceStorefrontPolicy(
    normalizeProviderTemplatesPayload(result.payload),
    configKey,
  )
  if (templates.length === 0) {
    throw new Error('Config center provider templates payload is empty')
  }

  return {
    configKey,
    versionCode: result.versionCode,
    versionName: result.versionName,
    fetchedAt: new Date().toISOString(),
    content: {
      providers: templates,
    },
  }
}

export async function loadProviderTemplates(builtinTemplates: AiConfig[]): Promise<AiConfig[]> {
  const store = await Store.load('store.json')
  const cached = await store.get<ProviderTemplateCache>(PROVIDER_TEMPLATE_CACHE_KEY)
  const configKey = await getProviderTemplateConfigKey()
  const matchingCache = cached?.configKey === configKey ? cached : undefined

  try {
    const latest = await fetchProviderTemplatesFromConfigCenter(configKey, matchingCache?.versionCode)
    if (latest) {
      await store.set(PROVIDER_TEMPLATE_CACHE_KEY, latest)
      await store.save()
      return enforceStorefrontPolicy(mergeProviderTemplates(
        mapRemoteTemplates(latest.content),
        mapBuiltinTemplates(builtinTemplates),
      ), configKey)
    }

    if (matchingCache?.content?.providers?.length) {
      return enforceStorefrontPolicy(mergeProviderTemplates(
        mapRemoteTemplates(matchingCache.content),
        mapBuiltinTemplates(builtinTemplates),
      ), configKey)
    }
  } catch (error) {
    console.warn(
      '[provider-templates] remote config unavailable; using cached or built-in templates:',
      error instanceof Error ? error.message : String(error),
    )
  }

  if (matchingCache?.content?.providers?.length) {
    return enforceStorefrontPolicy(mergeProviderTemplates(
      mapRemoteTemplates(matchingCache.content),
      mapBuiltinTemplates(builtinTemplates),
    ), configKey)
  }

  return enforceStorefrontPolicy(mapBuiltinTemplates(builtinTemplates), configKey)
}

export function getProviderTemplateMatch(currentConfig: AiConfig | undefined, templates: AiConfig[]) {
  return matchProviderTemplate({
    currentConfig,
    templates,
  }) as AiConfig | null
}
