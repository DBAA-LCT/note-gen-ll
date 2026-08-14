
import Database, { type QueryResult } from '@tauri-apps/plugin-sql';

let coreDatabasePromise: Promise<Database> | null = null

async function loadCoreDatabase(): Promise<Database> {
  const database = await Database.load('sqlite:note.db')

  // Core schema migrations finish before the database is exposed. Keeping this
  // initialization lazy avoids top-level await in every web/mobile route that
  // imports the database facade.
  await database.execute(`
    create table if not exists marks (
      id integer primary key autoincrement,
      tagId integer not null,
      type text not null,
      content text default null,
      url text default null,
      desc text default null,
      deleted integer default 0,
      createdAt integer,
      sourceId text default null
    )
  `)
  try {
    await database.select('select sourceId from marks limit 1')
  } catch {
    await database.execute('alter table marks add column sourceId text default null')
  }
  await database.execute('create unique index if not exists idx_marks_source_id on marks(sourceId) where sourceId is not null')
  return database
}

// 获取数据库实例(兼容旧代码)
export async function getDb(): Promise<Database> {
  if (!coreDatabasePromise) {
    coreDatabasePromise = loadCoreDatabase().catch((error) => {
      coreDatabasePromise = null
      throw error
    })
  }
  return coreDatabasePromise
}

// Keep the existing db.select/db.execute API while initializing on first use.
export const db = {
  async execute(query: string, bindValues?: unknown[]): Promise<QueryResult> {
    return (await getDb()).execute(query, bindValues)
  },
  async select<T>(query: string, bindValues?: unknown[]): Promise<T> {
    return (await getDb()).select<T>(query, bindValues)
  },
  async close(databaseName?: string): Promise<boolean> {
    if (!coreDatabasePromise) return true
    const database = await coreDatabasePromise
    const closed = await database.close(databaseName)
    coreDatabasePromise = null
    databaseInitialization = null
    return closed
  },
}

let databaseInitialization: Promise<void> | null = null

async function initializeAllDatabases() {
  // 引入各数据库初始化函数
  const { initChatsDb } = await import('./chats');
  const { initMarksDb } = await import('./marks');
  const { initNotesDb } = await import('./notes');
  const { initTagsDb } = await import('./tags');
  const { initVectorDb } = await import('./vector');
  const { initConversationsDb } = await import('./conversations');
  const { initMemoriesDb } = await import('./memories');
  const { initActivityDb } = await import('./activity');
  const { initCanvasesDb } = await import('./canvases');
  const { initConversationCompactionsDb } = await import('./conversation-compactions');
  const { initConversationSyncStateDb } = await import('./conversation-sync-state');
  const { initImageAnalysisCacheDb } = await import('./image-analysis-cache');
  const { initKnowledgeDb } = await import('./knowledge');
  const { initLearningDb } = await import('./learning');

  // 执行初始化：先确保基础表存在，再做 conversations 对 chats 的迁移/补列。
  await initChatsDb();
  await initConversationsDb();
  await initConversationCompactionsDb();
  await initConversationSyncStateDb();
  await initImageAnalysisCacheDb();
  await initMarksDb();
  await initNotesDb();
  await initTagsDb();
  await initVectorDb();
  await initMemoriesDb();
  await initLearningDb();
  await initActivityDb();
  await initCanvasesDb();
  await initKnowledgeDb();
  const { bootstrapStructuredKnowledgeRegistry } = await import('@/lib/knowledge-index');
  await bootstrapStructuredKnowledgeRegistry();

  const { Store } = await import('@tauri-apps/plugin-store')
  const store = await Store.load('store.json')
  if (await store.get<boolean>('conversationSyncInitialized') === undefined) {
    await store.set('conversationSyncInitialized', true)
    await store.save()
    const { enqueueAutoDataSync } = await import('@/lib/sync/auto-data-sync-queue')
    enqueueAutoDataSync('conversations', 'conversations-sync-initialized')
  }
}

// 初始化所有数据库。同一进程内复用初始化任务，避免多个页面入口并发执行迁移。
export function initAllDatabases(): Promise<void> {
  if (!databaseInitialization) {
    databaseInitialization = initializeAllDatabases().catch((error) => {
      databaseInitialization = null
      throw error
    })
  }

  return databaseInitialization
}
