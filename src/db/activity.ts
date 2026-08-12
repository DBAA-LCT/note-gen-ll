import { getDb } from './index'
import { getAllChats } from './chats'
import { getAllMarks } from './marks'
import { getAllMarkdownFiles } from '@/lib/files'
import { shouldCreateWritingSession, truncateActivityText } from '@/lib/activity/events'

export type ActivityEventSource = 'record' | 'chat' | 'writing' | 'learning'

export interface ActivityEvent {
  id: number
  source: ActivityEventSource
  title: string
  description?: string | null
  path?: string | null
  tagId?: number | null
  dedupeKey?: string | null
  createdAt: number
}

interface InsertActivityEventInput {
  source: ActivityEventSource
  title: string
  description?: string | null
  path?: string | null
  tagId?: number | null
  dedupeKey?: string | null
  createdAt?: number
}

export async function initActivityDb() {
  const db = await getDb()

  await db.execute(`
    create table if not exists activity_events (
      id integer primary key autoincrement,
      source text not null,
      title text not null,
      description text default null,
      path text default null,
      tagId integer default null,
      dedupeKey text default null,
      createdAt integer not null
    )
  `)

  try {
    await db.execute(`
      create unique index if not exists idx_activity_events_dedupe
      on activity_events(dedupeKey)
      where dedupeKey is not null
    `)
  } catch {
  }

  await db.execute(`
    create index if not exists idx_activity_events_created_at
    on activity_events(createdAt desc)
  `)

  await db.execute(`
    create index if not exists idx_activity_events_source_path_created_at
    on activity_events(source, path, createdAt desc)
  `)

  await backfillActivityEvents()
}

export async function insertActivityEvent(event: InsertActivityEventInput) {
  const db = await getDb()
  const createdAt = event.createdAt ?? Date.now()

  return await db.execute(
    `insert or ignore into activity_events
      (source, title, description, path, tagId, dedupeKey, createdAt)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      event.source,
      event.title,
      event.description ?? null,
      event.path ?? null,
      event.tagId ?? null,
      event.dedupeKey ?? null,
      createdAt,
    ]
  )
}

export async function getAllActivityEvents() {
  const db = await getDb()
  return await db.select<ActivityEvent[]>(`
    select id, source, title, description, path, tagId, dedupeKey, createdAt
    from activity_events
    order by createdAt desc
  `)
}

async function getLatestWritingEventTimestamp(path: string) {
  const db = await getDb()
  const result = await db.select<{ createdAt: number }[]>(
    `select createdAt from activity_events
     where source = 'writing' and path = $1
     order by createdAt desc
     limit 1`,
    [path]
  )

  return result[0]?.createdAt
}

export async function recordWritingActivity(params: {
  path: string
  title: string
  description?: string
  tagId?: number | null
  createdAt?: number
}) {
  const createdAt = params.createdAt ?? Date.now()
  const lastCreatedAt = await getLatestWritingEventTimestamp(params.path)

  if (!shouldCreateWritingSession(lastCreatedAt, createdAt)) {
    return null
  }

  return await insertActivityEvent({
    source: 'writing',
    title: truncateActivityText(params.title, 64),
    description: truncateActivityText(params.description ?? params.path, 140),
    path: params.path,
    tagId: params.tagId ?? null,
    dedupeKey: `writing:${params.path}:${createdAt}`,
    createdAt,
  })
}

async function backfillActivityEvents() {
  const [marks, chats, files] = await Promise.all([
    getAllMarks(),
    getAllChats(),
    getAllMarkdownFiles(true),
  ])

  for (const mark of marks) {
    if (mark.deleted === 1) continue

    const preview = truncateActivityText(mark.desc || mark.content || mark.url || '', 140)

    await insertActivityEvent({
      source: 'record',
      title: preview || mark.type,
      description: preview || mark.type,
      tagId: mark.tagId,
      dedupeKey: `record:${mark.id}`,
      createdAt: mark.createdAt,
    })
  }

  for (const chat of chats) {
    if (chat.role !== 'user' || !chat.content?.trim()) continue

    const preview = truncateActivityText(chat.content, 140)

    await insertActivityEvent({
      source: 'chat',
      title: truncateActivityText(chat.content, 64),
      description: preview,
      tagId: chat.tagId,
      dedupeKey: `chat:${chat.id}`,
      createdAt: chat.createdAt,
    })
  }

  for (const file of files) {
    const modifiedAt = file.metadata?.modifiedAt?.getTime()
    if (!modifiedAt) continue

    await insertActivityEvent({
      source: 'writing',
      title: truncateActivityText(file.name, 64),
      description: truncateActivityText(file.relativePath, 140),
      path: file.relativePath,
      dedupeKey: `writing-backfill:${file.relativePath}:${modifiedAt}`,
      createdAt: modifiedAt,
    })
  }

  await backfillLearningActivityEvents()
}

async function backfillLearningActivityEvents() {
  const db = await getDb()
  try {
    const [goals, tasks, sessions, reports] = await Promise.all([
      db.select<Array<{ id: string; title: string; description: string; createdAt: number }>>(
        "select id,title,description,createdAt from learning_goals where status != 'deleted'",
      ),
      db.select<Array<{ id: string; title: string; description: string; notePath: string | null; goalTitle: string | null; updatedAt: number }>>(`
        select t.id,t.title,t.description,t.notePath,g.title as goalTitle,t.updatedAt
        from learning_tasks t left join learning_goals g on g.id=t.goalId
        where t.status='done'
      `),
      db.select<Array<{ id: string; effectiveSeconds: number; endedAt: number | null; updatedAt: number; taskTitle: string | null; goalTitle: string | null; notePath: string | null }>>(`
        select s.id,s.effectiveSeconds,s.endedAt,s.updatedAt,t.title as taskTitle,g.title as goalTitle,t.notePath
        from focus_sessions s
        left join learning_tasks t on t.id=s.taskId
        left join learning_goals g on g.id=s.goalId
        where s.status='completed' and s.effectiveSeconds>0
      `),
      db.select<Array<{ localDate: string; overall: string; markdownPath: string | null; version: number; updatedAt: number }>>(
        'select localDate,overall,markdownPath,version,updatedAt from daily_reports where archivedAt is null',
      ),
    ])

    for (const goal of goals) {
      await insertActivityEvent({
        source: 'learning',
        title: `创建目标：${truncateActivityText(goal.title, 52)}`,
        description: truncateActivityText(goal.description, 140),
        dedupeKey: `learning-goal:${goal.id}`,
        createdAt: goal.createdAt,
      })
    }
    for (const task of tasks) {
      await insertActivityEvent({
        source: 'learning',
        title: `完成任务：${truncateActivityText(task.title, 52)}`,
        description: truncateActivityText(task.goalTitle ? `${task.goalTitle} · ${task.description || '目标任务'}` : task.description || '目标任务', 140),
        path: task.notePath,
        dedupeKey: `learning-task:${task.id}`,
        createdAt: task.updatedAt,
      })
    }
    for (const session of sessions) {
      const minutes = Math.max(1, Math.round(session.effectiveSeconds / 60))
      const target = session.taskTitle || session.goalTitle || '自由专注'
      await insertActivityEvent({
        source: 'learning',
        title: `专注 ${minutes} 分钟`,
        description: truncateActivityText(target, 140),
        path: session.notePath,
        dedupeKey: `learning-focus:${session.id}`,
        createdAt: session.endedAt || session.updatedAt,
      })
    }
    for (const report of reports) {
      await insertActivityEvent({
        source: 'learning',
        title: `完成复盘：${report.localDate}`,
        description: truncateActivityText(report.overall || '已保存当日复盘', 140),
        path: report.markdownPath,
        dedupeKey: `learning-report:${report.localDate}`,
        createdAt: report.updatedAt,
      })
    }
  } catch {
    // Fresh databases may initialize activity before optional feature tables exist.
  }
}
