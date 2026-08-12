import type { AgentContextSnapshot, AgentTool } from './types'

const MAX_ROUTED_TOOLS = 18

export interface AgentToolRoutingResult {
  tools: AgentTool[]
  domains: string[]
  reason: string
  totalToolCount: number
  capabilityQuestion: boolean
}

const DOMAIN_LABELS: Record<string, string> = {
  editor: 'current-note editing',
  notes: 'workspace notes',
  knowledge: 'knowledge retrieval',
  folders: 'folders',
  tags: 'tags',
  marks: 'quick records',
  memory: 'long-term memory',
  skills: 'skills',
  mcp: 'external MCP services',
  attachments: 'attachments',
  images: 'image inspection',
  web: 'web research',
  learning: 'learning workspace',
  canvas: 'canvas',
  utility: 'utilities',
}

function matches(text: string, pattern: RegExp) {
  return pattern.test(text)
}

function lexicalTokens(value: string) {
  const normalized = value.toLocaleLowerCase()
  const latin = normalized.match(/[a-z0-9][a-z0-9_-]{2,}/g) || []
  const cjkRuns = normalized.match(/[\u3400-\u9fff]{2,}/g) || []
  const cjk = cjkRuns.flatMap((run) => {
    const tokens: string[] = []
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.push(run.slice(index, index + 2))
    }
    return tokens
  })
  return [...new Set([...latin, ...cjk])]
}

function lexicalScore(query: string, tool: AgentTool) {
  const corpus = `${tool.name} ${tool.title} ${tool.description}`.toLocaleLowerCase()
  return lexicalTokens(query).reduce((score, token) => (
    corpus.includes(token) ? score + (token.length > 2 ? 2 : 1) : score
  ), 0)
}

export function routeAgentTools(
  context: AgentContextSnapshot,
  availableTools: AgentTool[]
): AgentToolRoutingResult {
  const text = context.userInput.trim()
  const selected = new Set<string>()
  const domains = new Set<string>()
  const priorities = new Map<string, number>()
  const availableNames = new Set(availableTools.map(tool => tool.name))

  const capabilityQuestion = matches(
    text,
    /(?:你|妳|您).{0,8}(?:会什么|能做什么|有什么功能|有什么能力|有哪些工具|有什么工具)|(?:工具|能力|功能).{0,8}(?:清单|列表|有哪些|是什么)|what can you do|your (?:tools|capabilities)|available tools/i
  )

  const add = (domain: string, names: string[], priority = 10) => {
    let added = false
    for (const name of names) {
      if (!availableNames.has(name)) continue
      selected.add(name)
      priorities.set(name, Math.max(priorities.get(name) || 0, priority))
      added = true
    }
    if (added) domains.add(domain)
  }

  const addByPrefix = (domain: string, prefix: string, priority = 10) => {
    add(domain, availableTools.filter(tool => tool.name.startsWith(prefix)).map(tool => tool.name), priority)
  }

  // A standing instruction may be expressed without saying "memory", so keep the
  // single write tool available on ordinary turns. It is a background safeguard,
  // not a routed domain unless the request actually concerns durable preferences.
  if (availableNames.has('memory_create')) {
    selected.add('memory_create')
    priorities.set('memory_create', 100)
  }

  const durablePreference = matches(text, /以后|从现在起|默认|每次都|始终|不要再|remember|from now on|always|never again/i)
  if (durablePreference || matches(text, /记忆|记住|忘掉|偏好|memory|remember/i)) {
    add('memory', ['memory_list', 'memory_create', 'memory_delete', 'memory_clear_all'], 70)
  }

  const editorAction = matches(text, /修改|改写|润色|续写|补充|插入|替换|删除.{0,6}(?:这段|选中|当前)|整理.{0,6}(?:这篇|当前|选中)|写入|编辑|排版|改成|改为|edit|rewrite|polish|insert|replace|append/i)
  if (context.activeFilePath && (editorAction || Boolean(context.currentQuote))) {
    add('editor', [
      'editor_get_state',
      'editor_get_selection',
      'editor_insert_at_cursor',
      'editor_replace_range',
      'editor_replace_lines',
      'editor_apply_transaction',
    ], 80)
  }

  const knowledgeIntent = matches(text, /知识库|我的(?:笔记|记录|文章|资料|计划|决定|偏好)|之前|上次|曾经|帮我找|查找|搜索笔记|检索|knowledge|my notes|find (?:my|the) (?:note|record)/i)
  if (knowledgeIntent) {
    add('knowledge', ['knowledge_search', 'knowledge_read_sources', 'knowledge_cite_sources'], 75)
  }

  const noteIntent = matches(text, /笔记|文章|markdown|\.md\b|文件|文档|note|document|file/i)
  const namedOrWorkspaceFileIntent = matches(
    text,
    /工作区|笔记库|另一个|其他|某个|指定|文件名|路径|\.md\b|新建|创建|打开|切换|删除|重命名|移动|复制|workspace|another|specific|path|create|open|switch|delete|rename|move|copy/i
  )
  if (
    noteIntent
    && (!context.activeFilePath || namedOrWorkspaceFileIntent)
    && (!knowledgeIntent || namedOrWorkspaceFileIntent)
  ) {
    if (matches(text, /新建|创建|生成.{0,8}(?:笔记|文章|文件)|create|new (?:note|file|document)/i)) {
      add('notes', ['note_create_file', 'folder_check_exists', 'folder_create'], 65)
    }
    if (matches(text, /打开|切换|open|switch/i)) add('notes', ['note_list_files', 'note_open_file'], 65)
    if (matches(text, /读取|看看|内容|总结|分析|read|summari[sz]e|analy[sz]e/i)) add('notes', ['note_list_files', 'note_read_file', 'note_read_files_batch'], 55)
    if (matches(text, /更新|修改|写入|update|write/i) && !context.activeFilePath) add('notes', ['note_read_file', 'note_update_file'], 65)
    if (matches(text, /删除|移除|delete|remove/i)) add('notes', ['note_list_files', 'note_delete_file'], 65)
    if (matches(text, /重命名|rename/i)) add('notes', ['note_list_files', 'note_rename_file'], 65)
    if (matches(text, /移动|move/i)) add('notes', ['note_list_files', 'folder_list', 'note_move_file'], 65)
    if (matches(text, /复制|拷贝|copy|duplicate/i)) add('notes', ['note_list_files', 'folder_list', 'note_copy_file'], 65)
    if (![...domains].some(domain => domain === 'notes')) {
      add('notes', ['note_list_files', 'note_read_file', 'note_open_file'], 35)
    }
  }

  if (matches(text, /文件夹|目录|folder|directory/i)) addByPrefix('folders', 'folder_', 60)
  if (matches(text, /标签|tag/i)) addByPrefix('tags', 'tag_', 60)
  if (matches(text, /记录|闪念|mark|quick record/i)) addByPrefix('marks', 'mark_', 55)

  const learningIntent = context.activeFilePath?.startsWith('learning://')
    || matches(text, /学习|学习目标|学习任务|学习日程|学习计划|日报|学习复盘|专注|番茄|learning|study|daily report/i)
  if (learningIntent) addByPrefix('learning', 'learning_', 75)

  if (context.activeCanvasId && matches(text, /画布|节点|连线|图表|canvas|node|diagram/i)) {
    add('canvas', availableTools.filter(tool => tool.category === 'canvas').map(tool => tool.name), 70)
  }

  if (context.attachments?.length) addByPrefix('attachments', 'attachment_', 85)
  if (context.imageAttachments?.length || matches(text, /图片|图像|截图|照片|image|photo|screenshot/i)) {
    addByPrefix('images', 'image_', 70)
  }

  const webIntent = matches(text, /联网|上网|网页|搜索网络|最新|新闻|价格|天气|官网|查一下.{0,8}(?:新闻|价格|天气|网页|官网)|web|online|latest|news|price|weather/i)
  if (webIntent) addByPrefix('web', 'web_', 70)

  const skillIntent = Boolean(context.selectedSkills?.length)
    || matches(text, /skill|技能|工作流|安装.{0,6}(?:技能|skill)|卸载.{0,6}(?:技能|skill)/i)
    || (context.availableSkills || []).some(skill => lexicalTokens(text).some(token => (
      `${skill.name} ${skill.description || ''}`.toLocaleLowerCase().includes(token)
    )))
  if (skillIntent) {
    add('skills', [
      'skill_list', 'skill_load', 'skill_read_resource', 'skill_execute_script',
      'skill_search_remote', 'skill_inspect_source', 'skill_install_source',
      'skill_validate_package', 'skill_install_package', 'skill_uninstall',
      'skill_install_python_dependencies',
    ], context.selectedSkills?.length ? 95 : 65)
  }

  const mcpIntent = matches(text, /\bmcp\b|外部工具|外部服务|服务工具|连接的工具|插件工具/i)
  if (mcpIntent) {
    add('mcp', ['mcp_list_tools', 'mcp_list_resources', 'mcp_list_resource_templates', 'mcp_read_resource', 'mcp_call_tool'], 80)
  }

  const directMcpTools = availableTools
    .filter(tool => Boolean(tool.mcp))
    .map(tool => ({ tool, score: lexicalScore(text, tool) }))
    .filter(entry => mcpIntent || entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, mcpIntent ? 8 : 4)
  if (directMcpTools.length > 0) {
    add('mcp', directMcpTools.map(entry => entry.tool.name), mcpIntent ? 80 : 55)
  }

  if (matches(text, /日期|相差几天|多少天|date|days? between/i)) {
    add('utility', ['calculate_date_difference'], 55)
  }

  // Ambiguous action requests should still have a safe local path instead of
  // silently degrading into chat-only behavior.
  const actionIntent = matches(text, /帮我|请|创建|新建|修改|更新|删除|打开|整理|处理|执行|make|create|update|delete|open|do this/i)
  if (actionIntent && selected.size <= 1) {
    if (context.activeFilePath) {
      add('editor', ['editor_get_state', 'editor_replace_lines', 'editor_apply_transaction'], 30)
    } else {
      add('notes', ['note_list_files', 'note_read_file', 'note_create_file'], 30)
    }
  }

  const ranked = availableTools
    .filter(tool => selected.has(tool.name))
    .sort((left, right) => (
      (priorities.get(right.name) || 0) - (priorities.get(left.name) || 0)
      || lexicalScore(text, right) - lexicalScore(text, left)
    ))
    .slice(0, MAX_ROUTED_TOOLS)

  return {
    tools: ranked,
    domains: [...domains].map(domain => DOMAIN_LABELS[domain] || domain),
    reason: domains.size === 0
      ? 'direct-answer turn; no app action detected'
      : `matched ${[...domains].join(', ')}`,
    totalToolCount: availableTools.length,
    capabilityQuestion,
  }
}
