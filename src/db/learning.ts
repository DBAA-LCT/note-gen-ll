import { getDb } from "./index";
import { insertActivityEvent } from "./activity";
import { truncateActivityText } from "@/lib/activity/events";
import type {
  AiLearningTaskDraft,
  CreateLearningGoalInput,
  DailyReport,
  DailyReportGoalEntry,
  DailyReflection,
  FocusSession,
  LearningGoal,
  LearningGoalStatus,
  LearningKnowledgeBase,
  LearningKnowledgeItem,
  LearningReviewAttempt,
  LearningReviewSettings,
  LearningReviewState,
  LearningDaySummary,
  LearningSettings,
  LearningScheduleEvent,
  LearningTask,
  LearningTaskStatus,
  PeriodicLearningReport,
  PeriodicLearningReportMetrics,
  PeriodicLearningReportType,
  SaveDailyReportInput,
  SaveLearningScheduleEventInput,
  SaveLearningKnowledgeItemInput,
  UpdateLearningTaskInput,
} from "@/types/learning";
import {
  DEFAULT_LEARNING_SETTINGS,
  DEFAULT_REVIEW_SETTINGS,
} from "@/types/learning";
import type { PlannedTaskDraft } from "@/lib/learning/planner";
import { formatLocalDate } from "@/lib/learning/date";

type GoalRow = Omit<LearningGoal, "weeklyDays" | "deletedAt"> & {
  weeklyDays: string;
  deletedAt: number | null;
};

type TaskRow = Omit<LearningTask, "manuallyEdited"> & {
  manuallyEdited: number;
};

type FocusSessionRow = Omit<FocusSession, "taskIds"> & {
  taskIds: string;
};

type ReportRow = {
  localDate: string;
  overall: string;
  reflectionJson: string;
  markdownPath: string | null;
  completedAt: number | null;
  archivedAt: number | null;
  version: number;
  createdAt: number;
  updatedAt: number;
};

type ReportEntryRow = DailyReportGoalEntry & { reportDate: string };

function uuid() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapGoal(row: GoalRow): LearningGoal {
  return {
    ...row,
    weeklyDays: parseJson<number[]>(row.weeklyDays, []),
  };
}

function mapTask(row: TaskRow): LearningTask {
  return { ...row, manuallyEdited: Boolean(row.manuallyEdited) };
}

function mapFocusSession(row: FocusSessionRow): FocusSession {
  const taskIds = parseJson<string[]>(row.taskIds, []);
  return {
    ...row,
    taskIds: taskIds.length ? taskIds : row.taskId ? [row.taskId] : [],
  };
}

export async function initLearningDb() {
  const db = await getDb();
  await db.execute(`create table if not exists learning_goals (
    id text primary key,
    title text not null,
    description text not null default '',
    startDate text not null,
    endDate text not null,
    timeZone text not null,
    weeklyDays text not null default '[]',
    timeWeight integer not null default 1,
    color text not null default '#3b82f6',
    note text not null default '',
    status text not null default 'planned',
    progressPercent real not null default 0,
    createdAt integer not null,
    updatedAt integer not null,
    deletedAt integer default null
  )`);
  await db.execute(
    "create index if not exists idx_learning_goals_status_dates on learning_goals(status, startDate, endDate)",
  );
  try {
    await db.select<Array<{ planMarkdown: string }>>(
      "select planMarkdown from learning_goals limit 1",
    );
  } catch {
    await db.execute(
      "alter table learning_goals add column planMarkdown text not null default ''",
    );
  }

  await db.execute(`create table if not exists learning_tasks (
    id text primary key,
    goalId text default null,
    localDate text not null,
    title text not null,
    description text not null default '',
    completionCriteria text not null default '',
    plannedMinutes integer not null default 0,
    progressPercent real not null default 0,
    status text not null default 'todo',
    source text not null default 'manual',
    generationNote text not null default '',
    generatedFromDate text default null,
    generationKey text default null,
    manuallyEdited integer not null default 0,
    scheduledStart integer default null,
    scheduledEnd integer default null,
    sortOrder integer not null default 0,
    createdAt integer not null,
    updatedAt integer not null
  )`);
  await db.execute(
    "create unique index if not exists idx_learning_tasks_generation_key on learning_tasks(generationKey) where generationKey is not null",
  );
  await db.execute(
    "create index if not exists idx_learning_tasks_date on learning_tasks(localDate, status, sortOrder)",
  );
  await db.execute(
    "create index if not exists idx_learning_tasks_goal on learning_tasks(goalId, localDate)",
  );
  try {
    await db.select<Array<{ notePath: string | null }>>(
      "select notePath from learning_tasks limit 1",
    );
  } catch {
    await db.execute(
      "alter table learning_tasks add column notePath text default null",
    );
  }
  try {
    await db.select<Array<{ progressPercent: number }>>(
      "select progressPercent from learning_tasks limit 1",
    );
  } catch {
    await db.execute(
      "alter table learning_tasks add column progressPercent real not null default 0",
    );
    await db.execute(
      "update learning_tasks set progressPercent=100 where status='done'",
    );
  }

  await db.execute(`create table if not exists focus_sessions (
    id text primary key,
    taskId text default null,
    taskIds text not null default '[]',
    goalId text default null,
    localDate text not null,
    startedAt integer not null,
    endedAt integer default null,
    effectiveSeconds integer not null default 0,
    status text not null,
    createdAt integer not null,
    updatedAt integer not null
  )`);
  await db.execute(
    "create index if not exists idx_focus_sessions_date on focus_sessions(localDate, status)",
  );
  try {
    await db.select<Array<{ taskIds: string }>>(
      "select taskIds from focus_sessions limit 1",
    );
  } catch {
    await db.execute(
      "alter table focus_sessions add column taskIds text not null default '[]'",
    );
  }

  await db.execute(`create table if not exists daily_reports (
    localDate text primary key,
    overall text not null default '',
    reflectionJson text not null default '{}',
    markdownPath text default null,
    completedAt integer default null,
    archivedAt integer default null,
    version integer not null default 1,
    createdAt integer not null,
    updatedAt integer not null
  )`);
  try {
    await db.select<Array<{ completedAt: number | null }>>(
      "select completedAt from daily_reports limit 1",
    );
  } catch {
    await db.execute(
      "alter table daily_reports add column completedAt integer default null",
    );
  }
  try {
    await db.select<Array<{ archivedAt: number | null }>>(
      "select archivedAt from daily_reports limit 1",
    );
  } catch {
    await db.execute(
      "alter table daily_reports add column archivedAt integer default null",
    );
  }
  await db.execute(
    "update daily_reports set completedAt=archivedAt where archivedAt is not null and completedAt is null",
  );
  await db.execute(`create table if not exists daily_report_goal_entries (
    reportDate text not null,
    goalId text not null,
    goalTitle text not null,
    status text not null,
    progressPercent real not null default 0,
    studyMinutes integer not null default 0,
    content text not null default '',
    primary key(reportDate, goalId)
  )`);

  await db.execute(`create table if not exists learning_settings (
    id integer primary key check(id = 1),
    dailyStudyMinutes integer not null,
    timeZone text not null,
    weeklyDays text not null,
    autoCompleteGoals integer not null default 0,
    reportDirectory text not null
  )`);
  await db.execute(`create table if not exists periodic_learning_reports (
    id text primary key,
    type text not null,
    periodStart text not null,
    periodEnd text not null,
    title text not null,
    content text not null,
    metricsJson text not null default '{}',
    sourceDatesJson text not null default '[]',
    createdAt integer not null,
    updatedAt integer not null,
    unique(type, periodStart, periodEnd)
  )`);
  await db.execute(`create table if not exists learning_schedule_events (
    id text primary key,
    title text not null,
    localDate text not null,
    startTime text default null,
    endTime text default null,
    allDay integer not null default 0,
    kind text not null default 'schedule',
    notes text not null default '',
    createdAt integer not null,
    updatedAt integer not null
  )`);
  await db.execute(
    "create index if not exists idx_learning_schedule_events_date on learning_schedule_events(localDate, allDay, startTime)",
  );
  await db.execute(`create table if not exists learning_knowledge_bases (
    id text primary key, name text not null, description text not null default '', goalId text default null,
    source text not null default 'notegen', createdAt integer not null, updatedAt integer not null
  )`);
  await db.execute(`create table if not exists learning_knowledge_items (
    id text primary key, knowledgeBaseId text not null, type text not null, prompt text not null,
    answer text not null, aliasesJson text not null default '[]', tagsJson text not null default '[]',
    explanation text not null default '', notePath text default null, externalId text default null,
    externalSource text default null, gradingMode text not null default 'answer', createdAt integer not null, updatedAt integer not null
  )`);
  await db.execute(
    "create index if not exists idx_learning_items_base on learning_knowledge_items(knowledgeBaseId, type)",
  );
  await db.execute(
    "create unique index if not exists idx_learning_items_external on learning_knowledge_items(externalSource, externalId) where externalId is not null",
  );
  await db.execute(`create table if not exists learning_review_states (
    itemId text primary key, dueDate text not null, intervalDays integer not null default 0,
    easeFactor real not null default 2.3, repetitions integer not null default 0,
    mastery integer not null default 0, lastReviewedAt integer default null
  )`);
  await db.execute(`create table if not exists learning_review_attempts (
    id text primary key, itemId text not null, localDate text not null, userAnswer text not null default '',
    grade integer not null, correct integer not null default 0, feedback text not null default '', createdAt integer not null
  )`);
  await db.execute(
    "create index if not exists idx_learning_review_attempts_date on learning_review_attempts(localDate, itemId)",
  );
  await db.execute(`create table if not exists learning_review_settings (
    id integer primary key check(id = 1), enabled integer not null default 1, dailyCount integer not null default 10,
    knowledgeBaseIdsJson text not null default '[]', itemTypesJson text not null default '[]', maimemoTodayPercent integer not null default 60
  )`);
  await db.execute(
    `insert or ignore into learning_review_settings
    (id,enabled,dailyCount,knowledgeBaseIdsJson,itemTypesJson,maimemoTodayPercent) values(1,$1,$2,$3,$4,$5)`,
    [
      Number(DEFAULT_REVIEW_SETTINGS.enabled),
      DEFAULT_REVIEW_SETTINGS.dailyCount,
      JSON.stringify(DEFAULT_REVIEW_SETTINGS.knowledgeBaseIds),
      JSON.stringify(DEFAULT_REVIEW_SETTINGS.itemTypes),
      DEFAULT_REVIEW_SETTINGS.maimemoTodayPercent,
    ],
  );
  await db.execute(
    `insert or ignore into learning_settings
      (id, dailyStudyMinutes, timeZone, weeklyDays, autoCompleteGoals, reportDirectory)
     values (1, $1, $2, $3, $4, $5)`,
    [
      DEFAULT_LEARNING_SETTINGS.dailyStudyMinutes,
      DEFAULT_LEARNING_SETTINGS.timeZone,
      JSON.stringify(DEFAULT_LEARNING_SETTINGS.weeklyDays),
      Number(DEFAULT_LEARNING_SETTINGS.autoCompleteGoals),
      DEFAULT_LEARNING_SETTINGS.reportDirectory,
    ],
  );
  await db.execute(
    "update learning_settings set reportDirectory=$1 where reportDirectory=$2",
    ["规划报告/日报", "规划/日报"],
  );
  await db.execute(
    "update learning_settings set reportDirectory=$1 where reportDirectory=$2",
    ["规划报告/日报", "学习报告/日报"],
  );
}

export async function listLearningGoals(
  options: { includeDeleted?: boolean } = {},
): Promise<LearningGoal[]> {
  const db = await getDb();
  const where = options.includeDeleted ? "" : "where status != 'deleted'";
  const rows = await db.select<GoalRow[]>(
    `select * from learning_goals ${where} order by createdAt desc`,
  );
  return rows.map(mapGoal);
}

export async function createLearningGoal(
  input: CreateLearningGoalInput,
): Promise<LearningGoal> {
  const db = await getDb();
  const now = Date.now();
  const goal: LearningGoal = {
    id: uuid(),
    ...input,
    status:
      input.startDate > formatLocalDate(now, input.timeZone)
        ? "planned"
        : "active",
    progressPercent: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await db.execute(
    `insert into learning_goals
      (id,title,description,startDate,endDate,timeZone,weeklyDays,timeWeight,color,note,planMarkdown,status,progressPercent,createdAt,updatedAt,deletedAt)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      goal.id,
      goal.title,
      goal.description,
      goal.startDate,
      goal.endDate,
      goal.timeZone,
      JSON.stringify(goal.weeklyDays),
      goal.timeWeight,
      goal.color,
      goal.note,
      goal.planMarkdown,
      goal.status,
      goal.progressPercent,
      goal.createdAt,
      goal.updatedAt,
      goal.deletedAt,
    ],
  );
  await insertActivityEvent({
    source: "learning",
    title: `创建目标：${truncateActivityText(goal.title, 52)}`,
    description: truncateActivityText(goal.description, 140),
    dedupeKey: `learning-goal:${goal.id}`,
    createdAt: now,
  });
  return goal;
}

export async function updateLearningGoal(
  id: string,
  input: CreateLearningGoalInput,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `update learning_goals set title=$1,description=$2,startDate=$3,endDate=$4,timeZone=$5,
      weeklyDays=$6,timeWeight=$7,color=$8,note=$9,planMarkdown=$10,updatedAt=$11 where id=$12 and status != 'deleted'`,
    [
      input.title,
      input.description,
      input.startDate,
      input.endDate,
      input.timeZone,
      JSON.stringify(input.weeklyDays),
      input.timeWeight,
      input.color,
      input.note,
      input.planMarkdown,
      Date.now(),
      id,
    ],
  );
}

export async function setLearningGoalStatus(
  id: string,
  status: LearningGoalStatus,
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    "update learning_goals set status=$1, deletedAt=$2, updatedAt=$3 where id=$4",
    [status, status === "deleted" ? now : null, now, id],
  );
  if (status === "archived" || status === "deleted" || status === "completed") {
    await db.execute(
      "update learning_tasks set status='cancelled', updatedAt=$1 where goalId=$2 and status in ('todo','in-progress') and localDate >= $3",
      [now, id, new Date(now).toISOString().slice(0, 10)],
    );
  }
}

export async function listLearningTasks(date: string): Promise<LearningTask[]> {
  const db = await getDb();
  const rows = await db.select<TaskRow[]>(
    `
    select t.*, g.title as goalTitle, g.color as goalColor
    from learning_tasks t left join learning_goals g on g.id=t.goalId
    where t.localDate=$1
    order by t.sortOrder asc, t.createdAt asc
  `,
    [date],
  );
  return rows.map(mapTask);
}

export async function listLearningTasksForGoal(
  goalId: string,
): Promise<LearningTask[]> {
  const rows = await (
    await getDb()
  ).select<TaskRow[]>(
    `
    select t.*, g.title as goalTitle, g.color as goalColor
    from learning_tasks t left join learning_goals g on g.id=t.goalId
    where t.goalId=$1 order by t.localDate desc, t.sortOrder asc, t.createdAt asc
  `,
    [goalId],
  );
  return rows.map(mapTask);
}

export async function insertPlannedTasks(
  tasks: PlannedTaskDraft[],
): Promise<number> {
  const db = await getDb();
  let inserted = 0;
  for (const task of tasks) {
    const now = Date.now();
    const result = await db.execute(
      `insert or ignore into learning_tasks
        (id,goalId,localDate,title,description,completionCriteria,plannedMinutes,status,source,generationNote,
         generatedFromDate,generationKey,manuallyEdited,scheduledStart,scheduledEnd,sortOrder,createdAt,updatedAt)
       values ($1,$2,$3,$4,$5,$6,$7,'todo','local-rule',$8,null,$9,0,null,null,$10,$11,$11)`,
      [
        uuid(),
        task.goalId,
        task.localDate,
        task.title,
        task.description,
        task.completionCriteria,
        task.plannedMinutes,
        task.generationNote,
        task.generationKey,
        task.sortOrder,
        now,
      ],
    );
    inserted += result.rowsAffected;
  }
  return inserted;
}

export async function createManualLearningTask(input: {
  localDate: string;
  goalId?: string | null;
  notePath?: string | null;
  title: string;
  description?: string;
  plannedMinutes: number;
}): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    `insert into learning_tasks
      (id,goalId,notePath,localDate,title,description,completionCriteria,plannedMinutes,status,source,generationNote,
       generatedFromDate,generationKey,manuallyEdited,scheduledStart,scheduledEnd,sortOrder,createdAt,updatedAt)
     values ($1,$2,$3,$4,$5,$6,'',$7,'todo','manual','手工创建',null,null,1,null,null,999,$8,$8)`,
    [
      uuid(),
      input.goalId || null,
      input.notePath || null,
      input.localDate,
      input.title,
      input.description || "",
      input.plannedMinutes,
      now,
    ],
  );
}

export async function setLearningTaskStatus(
  id: string,
  status: LearningTaskStatus,
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  const progressPercent =
    status === "done" ? 100 : status === "todo" ? 0 : null;
  await db.execute(
    progressPercent === null
      ? "update learning_tasks set status=$1, updatedAt=$2 where id=$3"
      : "update learning_tasks set status=$1, progressPercent=$2, updatedAt=$3 where id=$4",
    progressPercent === null
      ? [status, now, id]
      : [status, progressPercent, now, id],
  );
  if (status === "done") {
    const task = (
      await db.select<
        Array<{
          title: string;
          description: string;
          notePath: string | null;
          goalTitle: string | null;
        }>
      >(
        `
      select t.title,t.description,t.notePath,g.title as goalTitle
      from learning_tasks t left join learning_goals g on g.id=t.goalId
      where t.id=$1 limit 1
    `,
        [id],
      )
    )[0];
    if (task) {
      await insertActivityEvent({
        source: "learning",
        title: `完成任务：${truncateActivityText(task.title, 52)}`,
        description: truncateActivityText(
          task.goalTitle
            ? `${task.goalTitle} · ${task.description || "目标任务"}`
            : task.description || "目标任务",
          140,
        ),
        path: task.notePath,
        dedupeKey: `learning-task:${id}`,
        createdAt: now,
      });
    }
  }
}

export async function setLearningTaskProgress(
  id: string,
  progress: number,
): Promise<void> {
  const db = await getDb();
  const progressPercent = Math.max(0, Math.min(100, Math.round(progress)));
  const current = (
    await db.select<Array<{ status: LearningTaskStatus }>>(
      "select status from learning_tasks where id=$1 limit 1",
      [id],
    )
  )[0];
  const status: LearningTaskStatus =
    progressPercent >= 100
      ? "done"
      : progressPercent > 0
        ? "in-progress"
        : "todo";
  await db.execute(
    "update learning_tasks set progressPercent=$1,status=$2,manuallyEdited=1,updatedAt=$3 where id=$4",
    [progressPercent, status, Date.now(), id],
  );
  if (status === "done" && current?.status !== "done") {
    const task = (
      await db.select<
        Array<{
          title: string;
          description: string;
          notePath: string | null;
          goalTitle: string | null;
        }>
      >(
        `
      select t.title,t.description,t.notePath,g.title as goalTitle
      from learning_tasks t left join learning_goals g on g.id=t.goalId
      where t.id=$1 limit 1
    `,
        [id],
      )
    )[0];
    if (task)
      await insertActivityEvent({
        source: "learning",
        title: `完成任务：${truncateActivityText(task.title, 52)}`,
        description: truncateActivityText(
          task.goalTitle
            ? `${task.goalTitle} · ${task.description || "目标任务"}`
            : task.description || "目标任务",
          140,
        ),
        path: task.notePath,
        dedupeKey: `learning-task:${id}`,
        createdAt: Date.now(),
      });
  }
}

export async function updateLearningTask(
  id: string,
  input: UpdateLearningTaskInput,
): Promise<void> {
  const db = await getDb();
  const progressPercent = Math.max(
    0,
    Math.min(100, Math.round(input.progressPercent)),
  );
  const status: LearningTaskStatus =
    progressPercent >= 100
      ? "done"
      : progressPercent > 0
        ? "in-progress"
        : "todo";
  await db.execute(
    `update learning_tasks
     set title=$1,description=$2,completionCriteria=$3,plannedMinutes=$4,
         progressPercent=$5,status=$6,manuallyEdited=1,updatedAt=$7
     where id=$8`,
    [
      input.title.trim(),
      input.description.trim(),
      input.completionCriteria.trim(),
      Math.max(0, Math.min(720, Math.round(input.plannedMinutes))),
      progressPercent,
      status,
      Date.now(),
      id,
    ],
  );
}

export async function replaceAiLearningTasks(
  localDate: string,
  tasks: AiLearningTaskDraft[],
  generatedFromDate: string | null = null,
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    "delete from learning_tasks where localDate=$1 and source in ('ai','local-rule') and status != 'done' and manuallyEdited=0",
    [localDate],
  );
  for (const [index, task] of tasks.entries()) {
    await db.execute(
      `insert into learning_tasks
        (id,goalId,notePath,localDate,title,description,completionCriteria,plannedMinutes,status,source,generationNote,
         generatedFromDate,generationKey,manuallyEdited,scheduledStart,scheduledEnd,sortOrder,createdAt,updatedAt)
       values ($1,$2,null,$3,$4,$5,$6,$7,'todo','ai','AI 每日规划',$8,$9,0,null,null,$10,$11,$11)`,
      [
        uuid(),
        task.goalId,
        localDate,
        task.title,
        task.description,
        task.completionCriteria,
        Math.max(0, Math.min(720, Math.round(task.plannedMinutes))),
        generatedFromDate,
        `ai-v1:${localDate}:${task.goalId}:${now}:${index}`,
        index,
        now,
      ],
    );
  }
}

export async function saveFocusSession(session: FocusSession): Promise<void> {
  const db = await getDb();
  await db.execute(
    `insert into focus_sessions
      (id,taskId,taskIds,goalId,localDate,startedAt,endedAt,effectiveSeconds,status,createdAt,updatedAt)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict(id) do update set taskId=excluded.taskId,taskIds=excluded.taskIds,goalId=excluded.goalId,localDate=excluded.localDate,
       endedAt=excluded.endedAt,effectiveSeconds=excluded.effectiveSeconds,status=excluded.status,updatedAt=excluded.updatedAt`,
    [
      session.id,
      session.taskId,
      JSON.stringify(session.taskIds),
      session.goalId,
      session.localDate,
      session.startedAt,
      session.endedAt,
      session.effectiveSeconds,
      session.status,
      session.createdAt,
      session.updatedAt,
    ],
  );
  if (session.status === "completed" && session.effectiveSeconds > 0) {
    const target = (
      await db.select<
        Array<{
          taskTitle: string | null;
          goalTitle: string | null;
          notePath: string | null;
        }>
      >(
        `
      select t.title as taskTitle,g.title as goalTitle,t.notePath
      from focus_sessions s
      left join learning_tasks t on t.id=s.taskId
      left join learning_goals g on g.id=s.goalId
      where s.id=$1 limit 1
    `,
        [session.id],
      )
    )[0];
    const minutes = Math.max(1, Math.round(session.effectiveSeconds / 60));
    await insertActivityEvent({
      source: "learning",
      title: `专注 ${minutes} 分钟`,
      description: truncateActivityText(
        target?.taskTitle || target?.goalTitle || "自由专注",
        140,
      ),
      path: target?.notePath,
      dedupeKey: `learning-focus:${session.id}`,
      createdAt: session.endedAt || session.updatedAt,
    });
  }
}

export async function listFocusSessions(date: string): Promise<FocusSession[]> {
  const db = await getDb();
  const rows = await db.select<FocusSessionRow[]>(
    "select * from focus_sessions where localDate=$1 order by startedAt asc",
    [date],
  );
  return rows.map(mapFocusSession);
}

export async function listLearningDaySummaries(
  startDate: string,
  endDate: string,
): Promise<LearningDaySummary[]> {
  const db = await getDb();
  const taskRows = await db.select<
    Array<{
      localDate: string;
      taskTotal: number;
      taskDone: number;
      plannedMinutes: number;
    }>
  >(
    `
    select localDate,
      count(*) as taskTotal,
      sum(case when status='done' then 1 else 0 end) as taskDone,
      sum(plannedMinutes) as plannedMinutes
    from learning_tasks
    where localDate between $1 and $2 and status != 'cancelled'
    group by localDate
  `,
    [startDate, endDate],
  );
  const sessionRows = await db.select<
    Array<{ localDate: string; effectiveSeconds: number }>
  >(
    `
    select localDate, sum(effectiveSeconds) as effectiveSeconds
    from focus_sessions
    where localDate between $1 and $2 and status='completed'
    group by localDate
  `,
    [startDate, endDate],
  );
  const reportRows = await db.select<Array<{ localDate: string }>>(
    "select localDate from daily_reports where localDate between $1 and $2 and archivedAt is null",
    [startDate, endDate],
  );
  const summaries = new Map<string, LearningDaySummary>();
  const ensure = (localDate: string) => {
    const existing = summaries.get(localDate);
    if (existing) return existing;
    const summary: LearningDaySummary = {
      localDate,
      taskTotal: 0,
      taskDone: 0,
      plannedMinutes: 0,
      focusedMinutes: 0,
      hasReport: false,
      checkedIn: false,
    };
    summaries.set(localDate, summary);
    return summary;
  };
  taskRows.forEach((row) =>
    Object.assign(ensure(row.localDate), {
      taskTotal: Number(row.taskTotal) || 0,
      taskDone: Number(row.taskDone) || 0,
      plannedMinutes: Number(row.plannedMinutes) || 0,
    }),
  );
  sessionRows.forEach((row) => {
    ensure(row.localDate).focusedMinutes = Math.round(
      (Number(row.effectiveSeconds) || 0) / 60,
    );
  });
  const completedReportRows = await db.select<Array<{ localDate: string }>>(
    "select localDate from daily_reports where localDate between $1 and $2 and archivedAt is null and completedAt is not null",
    [startDate, endDate],
  );
  reportRows.forEach((row) => {
    ensure(row.localDate).hasReport = true;
  });
  completedReportRows.forEach((row) => {
    ensure(row.localDate).checkedIn = true;
  });
  return [...summaries.values()].sort((left, right) =>
    left.localDate.localeCompare(right.localDate),
  );
}

async function getDailyReportInternal(
  date: string,
  includeArchived = false,
): Promise<DailyReport | null> {
  const db = await getDb();
  const report = (
    await db.select<ReportRow[]>(
      `select * from daily_reports where localDate=$1 ${includeArchived ? "" : "and archivedAt is null"} limit 1`,
      [date],
    )
  )[0];
  if (!report) return null;
  const entries = await db.select<ReportEntryRow[]>(
    "select * from daily_report_goal_entries where reportDate=$1 order by goalTitle asc",
    [date],
  );
  const reflection = parseJson<DailyReflection>(report.reflectionJson, {
    energyLevel: null,
    focusLevel: null,
    biggestWin: "",
    biggestBlocker: "",
    nextIntention: "",
  });
  return {
    localDate: report.localDate,
    overall: report.overall,
    reflection,
    entries: entries.map((entry) => ({
      goalId: entry.goalId,
      goalTitle: entry.goalTitle,
      status: entry.status,
      progressPercent: entry.progressPercent,
      studyMinutes: entry.studyMinutes,
      content: entry.content,
    })),
    markdownPath: report.markdownPath,
    completedAt: report.completedAt,
    archivedAt: report.archivedAt,
    version: report.version,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}

export async function getDailyReport(date: string): Promise<DailyReport | null> {
  return getDailyReportInternal(date);
}

export async function listDailyReports(
  startDate: string,
  endDate: string,
): Promise<DailyReport[]> {
  const rows = await (
    await getDb()
  ).select<Array<{ localDate: string }>>(
    "select localDate from daily_reports where localDate between $1 and $2 and archivedAt is null order by localDate asc",
    [startDate, endDate],
  );
  const reports = await Promise.all(
    rows.map((row) => getDailyReport(row.localDate)),
  );
  return reports.filter((report): report is DailyReport => Boolean(report));
}

export async function listDailyReportsForSummary(
  startDate: string,
  endDate: string,
): Promise<DailyReport[]> {
  const rows = await (await getDb()).select<Array<{ localDate: string }>>(
    "select localDate from daily_reports where localDate between $1 and $2 order by localDate asc",
    [startDate, endDate],
  );
  const reports = await Promise.all(rows.map((row) => getDailyReportInternal(row.localDate, true)));
  return reports.filter((report): report is DailyReport => Boolean(report));
}

export async function listArchivedDailyReports(): Promise<DailyReport[]> {
  const rows = await (await getDb()).select<Array<{ localDate: string }>>(
    "select localDate from daily_reports where archivedAt is not null order by localDate desc",
  );
  const reports = await Promise.all(rows.map((row) => getDailyReportInternal(row.localDate, true)));
  return reports.filter((report): report is DailyReport => Boolean(report));
}

export async function getPeriodicLearningReport(
  type: PeriodicLearningReportType,
  periodStart: string,
  periodEnd: string,
): Promise<PeriodicLearningReport | null> {
  const row = (
    await (
      await getDb()
    ).select<
      Array<{
        id: string;
        type: PeriodicLearningReportType;
        periodStart: string;
        periodEnd: string;
        title: string;
        content: string;
        metricsJson: string;
        sourceDatesJson: string;
        createdAt: number;
        updatedAt: number;
      }>
    >(
      "select * from periodic_learning_reports where type=$1 and periodStart=$2 and periodEnd=$3 limit 1",
      [type, periodStart, periodEnd],
    )
  )[0];
  if (!row) return null;
  return {
    ...row,
    metrics: parseJson<PeriodicLearningReportMetrics>(row.metricsJson, {
      focusedMinutes: 0,
      taskTotal: 0,
      taskDone: 0,
      studyDays: 0,
      reportDays: 0,
    }),
    sourceDates: parseJson<string[]>(row.sourceDatesJson, []),
  };
}

export async function listPeriodicLearningReports(
  type: PeriodicLearningReportType,
  startDate: string,
  endDate: string,
): Promise<PeriodicLearningReport[]> {
  const rows = await (await getDb()).select<Array<{ periodStart: string; periodEnd: string }>>(
    "select periodStart,periodEnd from periodic_learning_reports where type=$1 and periodEnd between $2 and $3 order by periodEnd asc",
    [type, startDate, endDate],
  );
  const reports = await Promise.all(rows.map((row) => getPeriodicLearningReport(type, row.periodStart, row.periodEnd)));
  return reports.filter((report): report is PeriodicLearningReport => Boolean(report));
}

export async function savePeriodicLearningReport(
  input: Omit<PeriodicLearningReport, "id" | "createdAt" | "updatedAt">,
) {
  const db = await getDb();
  const existing = await getPeriodicLearningReport(
    input.type,
    input.periodStart,
    input.periodEnd,
  );
  const now = Date.now();
  const id = existing?.id || uuid();
  await db.execute(
    `
    insert into periodic_learning_reports
      (id,type,periodStart,periodEnd,title,content,metricsJson,sourceDatesJson,createdAt,updatedAt)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    on conflict(type,periodStart,periodEnd) do update set
      title=excluded.title,content=excluded.content,metricsJson=excluded.metricsJson,
      sourceDatesJson=excluded.sourceDatesJson,updatedAt=excluded.updatedAt
  `,
    [
      id,
      input.type,
      input.periodStart,
      input.periodEnd,
      input.title,
      input.content,
      JSON.stringify(input.metrics),
      JSON.stringify(input.sourceDates),
      existing?.createdAt || now,
      now,
    ],
  );
  return (await getPeriodicLearningReport(
    input.type,
    input.periodStart,
    input.periodEnd,
  ))!;
}

export async function saveDailyReport(
  input: SaveDailyReportInput,
): Promise<DailyReport> {
  const db = await getDb();
  const existing = await getDailyReport(input.localDate);
  const now = Date.now();
  const version = (existing?.version || 0) + 1;
  await db.execute(
    `insert into daily_reports(localDate,overall,reflectionJson,markdownPath,completedAt,version,createdAt,updatedAt)
     values($1,$2,$3,$4,$5,$6,$7,$7)
     on conflict(localDate) do update set overall=excluded.overall,reflectionJson=excluded.reflectionJson,
       markdownPath=excluded.markdownPath,completedAt=excluded.completedAt,archivedAt=null,version=excluded.version,updatedAt=excluded.updatedAt`,
    [
      input.localDate,
      input.overall,
      JSON.stringify(input.reflection),
      input.markdownPath || existing?.markdownPath || null,
      input.completedAt === undefined
        ? existing?.completedAt || null
        : input.completedAt,
      version,
      existing?.createdAt || now,
    ],
  );
  await db.execute(
    "delete from daily_report_goal_entries where reportDate=$1",
    [input.localDate],
  );
  for (const entry of input.entries) {
    await db.execute(
      `insert into daily_report_goal_entries
        (reportDate,goalId,goalTitle,status,progressPercent,studyMinutes,content)
       values($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.localDate,
        entry.goalId,
        entry.goalTitle,
        entry.status,
        entry.progressPercent,
        entry.studyMinutes,
        entry.content,
      ],
    );
    await db.execute(
      "update learning_goals set progressPercent=$1, updatedAt=$2 where id=$3 and status != 'deleted'",
      [entry.progressPercent, now, entry.goalId],
    );
  }
  await insertActivityEvent({
    source: "learning",
    title: `完成复盘：${input.localDate}`,
    description: truncateActivityText(input.overall || "已保存当日复盘", 140),
    path: input.markdownPath || existing?.markdownPath || null,
    dedupeKey: `learning-report:${input.localDate}`,
    createdAt: now,
  });
  return (await getDailyReport(input.localDate))!;
}

export async function archiveDailyReport(date: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    "update daily_reports set archivedAt=$1, updatedAt=$1 where localDate=$2",
    [now, date],
  );
  await db.execute(
    "delete from activity_events where dedupeKey=$1",
    [`learning-report:${date}`],
  ).catch(() => undefined);
}

export async function restoreDailyReport(date: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "update daily_reports set archivedAt=null, updatedAt=$1 where localDate=$2",
    [Date.now(), date],
  );
}

export async function deleteDailyReportPermanently(date: string): Promise<void> {
  const db = await getDb();
  const archived = await db.select<Array<{ localDate: string }>>(
    "select localDate from daily_reports where localDate=$1 and archivedAt is not null limit 1",
    [date],
  );
  if (!archived.length) throw new Error("只能永久删除已归档的日报。");
  const weeklyRows = await db.select<Array<{ sourceDatesJson: string }>>(
    "select sourceDatesJson from periodic_learning_reports where type='week' and periodStart <= $1 and periodEnd >= $1",
    [date],
  );
  if (!weeklyRows.some((row) => parseJson<string[]>(row.sourceDatesJson, []).includes(date))) {
    throw new Error("该日报尚未纳入规划周报，不能永久删除。");
  }
  await db.execute("delete from daily_report_goal_entries where reportDate=$1", [date]);
  await db.execute("delete from daily_reports where localDate=$1", [date]);
  await db.execute("delete from activity_events where dedupeKey=$1", [`learning-report:${date}`]).catch(() => undefined);
}

export async function getLearningSettings(): Promise<LearningSettings> {
  const db = await getDb();
  const row = (
    await db.select<
      Array<{
        dailyStudyMinutes: number;
        timeZone: string;
        weeklyDays: string;
        autoCompleteGoals: number;
        reportDirectory: string;
      }>
    >("select * from learning_settings where id=1")
  )[0];
  if (!row) return DEFAULT_LEARNING_SETTINGS;
  return {
    dailyStudyMinutes: row.dailyStudyMinutes,
    timeZone: row.timeZone,
    weeklyDays: parseJson<number[]>(
      row.weeklyDays,
      DEFAULT_LEARNING_SETTINGS.weeklyDays,
    ),
    autoCompleteGoals: Boolean(row.autoCompleteGoals),
    reportDirectory: row.reportDirectory,
  };
}

export async function saveLearningSettings(
  settings: LearningSettings,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `update learning_settings set dailyStudyMinutes=$1,timeZone=$2,weeklyDays=$3,
      autoCompleteGoals=$4,reportDirectory=$5 where id=1`,
    [
      settings.dailyStudyMinutes,
      settings.timeZone,
      JSON.stringify(settings.weeklyDays),
      Number(settings.autoCompleteGoals),
      settings.reportDirectory,
    ],
  );
}

type ScheduleEventRow = Omit<LearningScheduleEvent, "allDay"> & {
  allDay: number;
};

function mapScheduleEvent(row: ScheduleEventRow): LearningScheduleEvent {
  return { ...row, allDay: Boolean(row.allDay) };
}

export async function listLearningScheduleEvents(
  start: string,
  end: string,
): Promise<LearningScheduleEvent[]> {
  const db = await getDb();
  const rows = await db.select<ScheduleEventRow[]>(
    `select * from learning_schedule_events where localDate >= $1 and localDate <= $2
     order by localDate, allDay desc, startTime, createdAt`,
    [start, end],
  );
  return rows.map(mapScheduleEvent);
}

export async function saveLearningScheduleEvent(
  input: SaveLearningScheduleEventInput,
  id?: string,
): Promise<LearningScheduleEvent> {
  const db = await getDb();
  const now = Date.now();
  const event: LearningScheduleEvent = {
    id: id || uuid(),
    ...input,
    startTime: input.allDay ? null : input.startTime,
    endTime: input.allDay ? null : input.endTime,
    createdAt: now,
    updatedAt: now,
  };
  const existing = id
    ? (
        await db.select<Array<{ createdAt: number }>>(
          "select createdAt from learning_schedule_events where id=$1",
          [id],
        )
      )[0]
    : null;
  event.createdAt = existing?.createdAt || now;
  await db.execute(
    `insert into learning_schedule_events
      (id,title,localDate,startTime,endTime,allDay,kind,notes,createdAt,updatedAt)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict(id) do update set title=excluded.title,localDate=excluded.localDate,
       startTime=excluded.startTime,endTime=excluded.endTime,allDay=excluded.allDay,
       kind=excluded.kind,notes=excluded.notes,updatedAt=excluded.updatedAt`,
    [
      event.id,
      event.title,
      event.localDate,
      event.startTime,
      event.endTime,
      Number(event.allDay),
      event.kind,
      event.notes,
      event.createdAt,
      event.updatedAt,
    ],
  );
  return event;
}

export async function deleteLearningScheduleEvent(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("delete from learning_schedule_events where id=$1", [id]);
}

export async function listLearningKnowledgeBases(): Promise<
  LearningKnowledgeBase[]
> {
  return (await getDb()).select<LearningKnowledgeBase[]>(
    "select * from learning_knowledge_bases order by createdAt asc",
  );
}

export async function saveLearningKnowledgeBase(
  input: Pick<
    LearningKnowledgeBase,
    "name" | "description" | "goalId" | "source"
  >,
  id?: string,
): Promise<LearningKnowledgeBase> {
  const db = await getDb();
  const now = Date.now();
  const existing = id
    ? (
        await db.select<LearningKnowledgeBase[]>(
          "select * from learning_knowledge_bases where id=$1",
          [id],
        )
      )[0]
    : null;
  const value: LearningKnowledgeBase = {
    id: id || uuid(),
    ...input,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await db.execute(
    `insert into learning_knowledge_bases(id,name,description,goalId,source,createdAt,updatedAt)
    values($1,$2,$3,$4,$5,$6,$7) on conflict(id) do update set name=excluded.name,description=excluded.description,
    goalId=excluded.goalId,source=excluded.source,updatedAt=excluded.updatedAt`,
    [
      value.id,
      value.name,
      value.description,
      value.goalId,
      value.source,
      value.createdAt,
      value.updatedAt,
    ],
  );
  return value;
}

export async function deleteLearningKnowledgeBase(id: string): Promise<void> {
  const db = await getDb();
  const itemIds = await db.select<Array<{ id: string }>>(
    "select id from learning_knowledge_items where knowledgeBaseId=$1",
    [id],
  );
  for (const item of itemIds) {
    await db.execute("delete from learning_review_states where itemId=$1", [
      item.id,
    ]);
    await db.execute("delete from learning_review_attempts where itemId=$1", [
      item.id,
    ]);
  }
  await db.execute(
    "delete from learning_knowledge_items where knowledgeBaseId=$1",
    [id],
  );
  await db.execute("delete from learning_knowledge_bases where id=$1", [id]);
}

type KnowledgeItemRow = Omit<LearningKnowledgeItem, "aliases" | "tags"> & {
  aliasesJson: string;
  tagsJson: string;
};
function mapKnowledgeItem(row: KnowledgeItemRow): LearningKnowledgeItem {
  const { aliasesJson, tagsJson, ...rest } = row;
  return {
    ...rest,
    aliases: parseJson<string[]>(aliasesJson, []),
    tags: parseJson<string[]>(tagsJson, []),
  };
}

export async function listLearningKnowledgeItems(
  baseId?: string,
): Promise<LearningKnowledgeItem[]> {
  const db = await getDb();
  const rows = baseId
    ? await db.select<KnowledgeItemRow[]>(
        "select * from learning_knowledge_items where knowledgeBaseId=$1 order by createdAt asc",
        [baseId],
      )
    : await db.select<KnowledgeItemRow[]>(
        "select * from learning_knowledge_items order by createdAt asc",
      );
  return rows.map(mapKnowledgeItem);
}

export async function saveLearningKnowledgeItem(
  input: SaveLearningKnowledgeItemInput,
  id?: string,
): Promise<LearningKnowledgeItem> {
  const db = await getDb();
  const now = Date.now();
  const existing = id
    ? (
        await db.select<KnowledgeItemRow[]>(
          "select * from learning_knowledge_items where id=$1",
          [id],
        )
      )[0]
    : input.externalId && input.externalSource
      ? (
          await db.select<KnowledgeItemRow[]>(
            "select * from learning_knowledge_items where externalId=$1 and externalSource=$2",
            [input.externalId, input.externalSource],
          )
        )[0]
      : null;
  const value: LearningKnowledgeItem = {
    id: id || existing?.id || uuid(),
    knowledgeBaseId: input.knowledgeBaseId,
    type: input.type,
    prompt: input.prompt,
    answer: input.answer,
    aliases: input.aliases || [],
    tags: input.tags || [],
    explanation: input.explanation || "",
    notePath: input.notePath || null,
    externalId: input.externalId || null,
    externalSource: input.externalSource || null,
    gradingMode: input.gradingMode || "answer",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await db.execute(
    `insert into learning_knowledge_items
    (id,knowledgeBaseId,type,prompt,answer,aliasesJson,tagsJson,explanation,notePath,externalId,externalSource,gradingMode,createdAt,updatedAt)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    on conflict(id) do update set knowledgeBaseId=excluded.knowledgeBaseId,type=excluded.type,prompt=excluded.prompt,
    answer=excluded.answer,aliasesJson=excluded.aliasesJson,tagsJson=excluded.tagsJson,explanation=excluded.explanation,
    notePath=excluded.notePath,externalId=excluded.externalId,externalSource=excluded.externalSource,
    gradingMode=excluded.gradingMode,updatedAt=excluded.updatedAt`,
    [
      value.id,
      value.knowledgeBaseId,
      value.type,
      value.prompt,
      value.answer,
      JSON.stringify(value.aliases),
      JSON.stringify(value.tags),
      value.explanation,
      value.notePath,
      value.externalId,
      value.externalSource,
      value.gradingMode,
      value.createdAt,
      value.updatedAt,
    ],
  );
  return value;
}

export async function deleteLearningKnowledgeItem(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("delete from learning_review_states where itemId=$1", [id]);
  await db.execute("delete from learning_review_attempts where itemId=$1", [
    id,
  ]);
  await db.execute("delete from learning_knowledge_items where id=$1", [id]);
}

export async function listLearningReviewStates(): Promise<
  LearningReviewState[]
> {
  return (await getDb()).select<LearningReviewState[]>(
    "select * from learning_review_states",
  );
}

export async function listLearningReviewAttempts(
  start?: string,
  end?: string,
): Promise<LearningReviewAttempt[]> {
  const db = await getDb();
  const rows =
    start && end
      ? await db.select<
          Array<Omit<LearningReviewAttempt, "correct"> & { correct: number }>
        >(
          "select * from learning_review_attempts where localDate between $1 and $2 order by createdAt",
          [start, end],
        )
      : await db.select<
          Array<Omit<LearningReviewAttempt, "correct"> & { correct: number }>
        >("select * from learning_review_attempts order by createdAt");
  return rows.map((row) => ({ ...row, correct: Boolean(row.correct) }));
}

export async function saveLearningReviewAttempt(
  attempt: LearningReviewAttempt,
  state: LearningReviewState,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `insert into learning_review_attempts(id,itemId,localDate,userAnswer,grade,correct,feedback,createdAt)
    values($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      attempt.id,
      attempt.itemId,
      attempt.localDate,
      attempt.userAnswer,
      attempt.grade,
      Number(attempt.correct),
      attempt.feedback,
      attempt.createdAt,
    ],
  );
  await db.execute(
    `insert into learning_review_states(itemId,dueDate,intervalDays,easeFactor,repetitions,mastery,lastReviewedAt)
    values($1,$2,$3,$4,$5,$6,$7) on conflict(itemId) do update set dueDate=excluded.dueDate,
    intervalDays=excluded.intervalDays,easeFactor=excluded.easeFactor,repetitions=excluded.repetitions,
    mastery=excluded.mastery,lastReviewedAt=excluded.lastReviewedAt`,
    [
      state.itemId,
      state.dueDate,
      state.intervalDays,
      state.easeFactor,
      state.repetitions,
      state.mastery,
      state.lastReviewedAt,
    ],
  );
}

export async function getLearningReviewSettings(): Promise<LearningReviewSettings> {
  const row = (
    await (
      await getDb()
    ).select<
      Array<{
        enabled: number;
        dailyCount: number;
        knowledgeBaseIdsJson: string;
        itemTypesJson: string;
        maimemoTodayPercent: number;
      }>
    >("select * from learning_review_settings where id=1")
  )[0];
  if (!row) return DEFAULT_REVIEW_SETTINGS;
  return {
    enabled: Boolean(row.enabled),
    dailyCount: row.dailyCount,
    knowledgeBaseIds: parseJson(row.knowledgeBaseIdsJson, []),
    itemTypes: parseJson(row.itemTypesJson, DEFAULT_REVIEW_SETTINGS.itemTypes),
    maimemoTodayPercent: row.maimemoTodayPercent,
  };
}

export async function saveLearningReviewSettings(
  settings: LearningReviewSettings,
): Promise<void> {
  await (
    await getDb()
  ).execute(
    `update learning_review_settings set enabled=$1,dailyCount=$2,
    knowledgeBaseIdsJson=$3,itemTypesJson=$4,maimemoTodayPercent=$5 where id=1`,
    [
      Number(settings.enabled),
      settings.dailyCount,
      JSON.stringify(settings.knowledgeBaseIds),
      JSON.stringify(settings.itemTypes),
      settings.maimemoTodayPercent,
    ],
  );
}
