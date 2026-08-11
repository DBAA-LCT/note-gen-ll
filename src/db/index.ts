
import Database from '@tauri-apps/plugin-sql';

// 导出数据库实例
export const db = await Database.load('sqlite:note.db');

// Core schema migrations must finish before this module exports. The desktop layout
// renders children while its initialization effect is still running, so altering a
// table later can invalidate SQLx's cached `select *` metadata on another query.
await db.execute(`
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
  await db.select('select sourceId from marks limit 1')
} catch {
  await db.execute('alter table marks add column sourceId text default null')
}
await db.execute('create unique index if not exists idx_marks_source_id on marks(sourceId) where sourceId is not null')

// 获取数据库实例(兼容旧代码)
export async function getDb() {
  return db;
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
