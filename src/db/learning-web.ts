import {
  planTasksForDate,
  type PlannedTaskDraft,
} from "@/lib/learning/planner";
import type {
  AiLearningTaskDraft,
  CreateLearningGoalInput,
  DailyReport,
  FocusSession,
  LearningDaySummary,
  LearningGoal,
  LearningGoalStatus,
  LearningKnowledgeBase,
  LearningKnowledgeItem,
  LearningReviewAttempt,
  LearningReviewSettings,
  LearningReviewState,
  LearningSettings,
  LearningScheduleEvent,
  LearningTask,
  LearningTaskStatus,
  PeriodicLearningReport,
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
import { formatLocalDate } from "@/lib/learning/date";
import {
  assertValidDailyReportInput,
  assertValidLearningGoalInput,
  assertValidLearningScheduleInput,
  isValidLocalDate,
  shouldRestoreGeneratedTask,
  taskStateForProgress,
} from "@/lib/learning/logic";

interface WebLearningState {
  goals: LearningGoal[];
  tasks: LearningTask[];
  sessions: FocusSession[];
  reports: DailyReport[];
  periodicReports: PeriodicLearningReport[];
  scheduleEvents: LearningScheduleEvent[];
  knowledgeBases: LearningKnowledgeBase[];
  knowledgeItems: LearningKnowledgeItem[];
  reviewStates: LearningReviewState[];
  reviewAttempts: LearningReviewAttempt[];
  reviewSettings: LearningReviewSettings;
  settings: LearningSettings;
}

const STORAGE_KEY = "notegen.learning.web.v1";
const emptyState = (): WebLearningState => ({
  goals: [],
  tasks: [],
  sessions: [],
  reports: [],
  periodicReports: [],
  scheduleEvents: [],
  knowledgeBases: [],
  knowledgeItems: [],
  reviewStates: [],
  reviewAttempts: [],
  reviewSettings: DEFAULT_REVIEW_SETTINGS,
  settings: DEFAULT_LEARNING_SETTINGS,
});

function readState(): WebLearningState {
  if (typeof window === "undefined") return emptyState();
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) || "",
    ) as Partial<WebLearningState>;
    return {
      ...emptyState(),
      ...parsed,
      goals: (parsed.goals || []).map((goal) => ({
        ...goal,
        planMarkdown: goal.planMarkdown || "",
      })),
      tasks: (parsed.tasks || []).map((task) => ({
        ...task,
        progressPercent: Number.isFinite(task.progressPercent)
          ? task.progressPercent
          : task.status === "done"
            ? 100
            : 0,
      })),
      sessions: (parsed.sessions || []).map((session) => ({
        ...session,
        taskIds: session.taskIds?.length
          ? session.taskIds
          : session.taskId
            ? [session.taskId]
            : [],
      })),
      reports: (parsed.reports || []).map((report) => ({
        ...report,
        completedAt: report.completedAt || null,
        archivedAt: report.archivedAt || null,
      })),
      settings: {
        ...DEFAULT_LEARNING_SETTINGS,
        ...parsed.settings,
        reportDirectory: parsed.settings?.reportDirectory === "规划/日报"
          || parsed.settings?.reportDirectory === "学习报告/日报"
          ? "规划报告/日报"
          : parsed.settings?.reportDirectory || DEFAULT_LEARNING_SETTINGS.reportDirectory,
      },
      reviewSettings: { ...DEFAULT_REVIEW_SETTINGS, ...parsed.reviewSettings },
    };
  } catch {
    return emptyState();
  }
}

function writeState(state: WebLearningState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uuid() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

export async function initLearningDb() {}
export async function listLearningGoals(
  options: { includeDeleted?: boolean } = {},
) {
  return readState().goals.filter(
    (goal) => options.includeDeleted || goal.status !== "deleted",
  );
}
export async function createLearningGoal(input: CreateLearningGoalInput) {
  assertValidLearningGoalInput(input);
  const state = readState();
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
  state.goals.unshift(goal);
  writeState(state);
  return goal;
}
export async function updateLearningGoal(
  id: string,
  input: CreateLearningGoalInput,
) {
  assertValidLearningGoalInput(input);
  const state = readState();
  const goal = state.goals.find((item) => item.id === id);
  if (!goal || goal.status === "deleted") throw new Error("目标不存在或已删除。");
  Object.assign(goal, input, { updatedAt: Date.now() });
  writeState(state);
}
export async function setLearningGoalStatus(
  id: string,
  status: LearningGoalStatus,
) {
  const state = readState();
  const now = Date.now();
  const goal = state.goals.find((item) => item.id === id);
  if (!goal) throw new Error("目标不存在。");
  if (goal.status === "deleted" && status !== "deleted") {
    throw new Error("已删除的目标不能重新启用。");
  }
  Object.assign(goal, {
    status,
    deletedAt: status === "deleted" ? now : null,
    updatedAt: now,
  });
  if (status === "archived" || status === "deleted" || status === "completed")
    state.tasks.forEach((task) => {
      if (
        task.goalId === id &&
        task.localDate >= formatLocalDate(now, goal.timeZone) &&
        (task.status === "todo" || task.status === "in-progress")
      ) {
        task.status = "cancelled";
        task.updatedAt = now;
      }
    });
  writeState(state);
}
export async function listLearningTasks(date: string) {
  const state = readState();
  return state.tasks
    .filter((task) => task.localDate === date)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((task) => {
      const goal = state.goals.find((item) => item.id === task.goalId);
      return { ...task, goalTitle: goal?.title, goalColor: goal?.color };
    });
}
export async function listLearningTasksForGoal(goalId: string) {
  const state = readState();
  const goal = state.goals.find((item) => item.id === goalId);
  return state.tasks
    .filter((task) => task.goalId === goalId)
    .sort(
      (a, b) =>
        b.localDate.localeCompare(a.localDate) || a.sortOrder - b.sortOrder,
    )
    .map((task) => ({
      ...task,
      goalTitle: goal?.title,
      goalColor: goal?.color,
    }));
}
export async function insertPlannedTasks(tasks: PlannedTaskDraft[]) {
  const state = readState();
  let inserted = 0;
  for (const draft of tasks) {
    const existing = state.tasks.find(
      (task) => task.generationKey === draft.generationKey,
    );
    if (existing) {
      if (shouldRestoreGeneratedTask(existing)) {
        Object.assign(existing, {
          status: "todo",
          progressPercent: 0,
          updatedAt: Date.now(),
        });
        inserted += 1;
      }
      continue;
    }
    const now = Date.now();
    state.tasks.push({
      id: uuid(),
      goalId: draft.goalId,
      notePath: null,
      localDate: draft.localDate,
      title: draft.title,
      description: draft.description,
      completionCriteria: draft.completionCriteria,
      plannedMinutes: draft.plannedMinutes,
      progressPercent: 0,
      status: "todo",
      source: "local-rule",
      generationNote: draft.generationNote,
      generatedFromDate: null,
      generationKey: draft.generationKey,
      manuallyEdited: false,
      scheduledStart: null,
      scheduledEnd: null,
      sortOrder: draft.sortOrder,
      createdAt: now,
      updatedAt: now,
    });
    inserted++;
  }
  writeState(state);
  return inserted;
}
export async function createManualLearningTask(input: {
  localDate: string;
  goalId?: string | null;
  notePath?: string | null;
  title: string;
  description?: string;
  plannedMinutes: number;
}) {
  if (!isValidLocalDate(input.localDate)) throw new Error("任务日期无效。");
  if (!input.title.trim()) throw new Error("任务标题不能为空。");
  const state = readState();
  const now = Date.now();
  state.tasks.push({
    id: uuid(),
    goalId: input.goalId || null,
    notePath: input.notePath || null,
    localDate: input.localDate,
    title: input.title.trim(),
    description: input.description?.trim() || "",
    completionCriteria: "",
    plannedMinutes: Math.max(0, Math.min(720, Math.round(input.plannedMinutes))),
    progressPercent: 0,
    status: "todo",
    source: "manual",
    generationNote: "手工创建",
    generatedFromDate: null,
    generationKey: null,
    manuallyEdited: true,
    scheduledStart: null,
    scheduledEnd: null,
    sortOrder: 999,
    createdAt: now,
    updatedAt: now,
  });
  writeState(state);
}
export async function replaceAiLearningTasks(
  localDate: string,
  drafts: AiLearningTaskDraft[],
  generatedFromDate: string | null = null,
) {
  if (!isValidLocalDate(localDate)) throw new Error("规划日期无效。");
  if (drafts.some((task) => !task.goalId || !task.title.trim() || !Number.isFinite(task.plannedMinutes))) {
    throw new Error("AI 规划中包含无效任务。");
  }
  const state = readState();
  const now = Date.now();
  state.tasks = state.tasks.filter(
    (task) =>
      !(
        task.localDate === localDate &&
        (task.source === "ai" || task.source === "local-rule") &&
        task.status !== "done" &&
        !task.manuallyEdited
      ),
  );
  drafts.forEach((draft, index) =>
    state.tasks.push({
      id: uuid(),
      goalId: draft.goalId,
      notePath: null,
      localDate,
      title: draft.title.trim(),
      description: draft.description.trim(),
      completionCriteria: draft.completionCriteria.trim(),
      plannedMinutes: Math.max(
        0,
        Math.min(720, Math.round(draft.plannedMinutes)),
      ),
      progressPercent: 0,
      status: "todo",
      source: "ai",
      generationNote: "AI 每日规划",
      generatedFromDate,
      generationKey: `ai-v1:${localDate}:${draft.goalId}:${now}:${index}`,
      manuallyEdited: false,
      scheduledStart: null,
      scheduledEnd: null,
      sortOrder: index,
      createdAt: now,
      updatedAt: now,
    }),
  );
  writeState(state);
}
export async function setLearningTaskStatus(
  id: string,
  status: LearningTaskStatus,
) {
  const state = readState();
  const task = state.tasks.find((item) => item.id === id);
  if (!task) throw new Error("任务不存在。");
  Object.assign(task, {
    status,
    progressPercent:
      status === "done" ? 100 : status === "todo" ? 0 : task.progressPercent,
    manuallyEdited: true,
    updatedAt: Date.now(),
  });
  writeState(state);
}
export async function setLearningTaskProgress(id: string, progress: number) {
  const state = readState();
  const task = state.tasks.find((item) => item.id === id);
  if (!task) throw new Error("任务不存在。");
  const nextState = taskStateForProgress(progress);
  Object.assign(task, {
    ...nextState,
    manuallyEdited: true,
    updatedAt: Date.now(),
  });
  writeState(state);
}
export async function updateLearningTask(
  id: string,
  input: UpdateLearningTaskInput,
) {
  if (!input.title.trim()) throw new Error("任务标题不能为空。");
  const state = readState();
  const task = state.tasks.find((item) => item.id === id);
  if (!task) throw new Error("任务不存在。");
  const nextState = taskStateForProgress(input.progressPercent);
  Object.assign(task, {
      title: input.title.trim(),
      description: input.description.trim(),
      completionCriteria: input.completionCriteria.trim(),
      plannedMinutes: Math.max(
        0,
        Math.min(720, Math.round(input.plannedMinutes)),
      ),
      ...nextState,
      manuallyEdited: true,
      updatedAt: Date.now(),
    });
  writeState(state);
}
export async function saveFocusSession(session: FocusSession) {
  const state = readState();
  const index = state.sessions.findIndex((item) => item.id === session.id);
  if (index >= 0) state.sessions[index] = session;
  else state.sessions.push(session);
  writeState(state);
}
export async function listFocusSessions(date: string) {
  return readState()
    .sessions.filter((session) => session.localDate === date)
    .sort((a, b) => a.startedAt - b.startedAt);
}
export async function getDailyReport(date: string) {
  return (
    readState().reports.find((report) => report.localDate === date && !report.archivedAt) || null
  );
}
export async function listDailyReports(start: string, end: string) {
  return readState()
    .reports.filter(
      (report) => report.localDate >= start && report.localDate <= end && !report.archivedAt,
    )
    .sort((a, b) => a.localDate.localeCompare(b.localDate));
}
export async function listDailyReportsForSummary(start: string, end: string) {
  return readState().reports
    .filter((report) => report.localDate >= start && report.localDate <= end)
    .sort((a, b) => a.localDate.localeCompare(b.localDate));
}
export async function listArchivedDailyReports() {
  return readState().reports
    .filter((report) => Boolean(report.archivedAt))
    .sort((a, b) => b.localDate.localeCompare(a.localDate));
}
export async function saveDailyReport(input: SaveDailyReportInput) {
  assertValidDailyReportInput(input);
  const state = readState();
  const existing = state.reports.find(
    (report) => report.localDate === input.localDate,
  );
  const now = Date.now();
  const report: DailyReport = {
    ...input,
    markdownPath: input.markdownPath || existing?.markdownPath || null,
    completedAt:
      input.completedAt === undefined
        ? existing?.completedAt || null
        : input.completedAt,
    archivedAt: null,
    version: (existing?.version || 0) + 1,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  state.reports = [
    ...state.reports.filter((item) => item.localDate !== input.localDate),
    report,
  ];
  input.entries.forEach((entry) => {
    const goal = state.goals.find((item) => item.id === entry.goalId);
    if (goal)
      Object.assign(goal, {
        progressPercent: entry.progressPercent,
        updatedAt: now,
      });
  });
  writeState(state);
  return report;
}
export async function archiveDailyReport(date: string) {
  const state = readState();
  const report = state.reports.find((item) => item.localDate === date);
  if (report) Object.assign(report, { archivedAt: Date.now(), updatedAt: Date.now() });
  writeState(state);
}
export async function restoreDailyReport(date: string) {
  const state = readState();
  const report = state.reports.find((item) => item.localDate === date);
  if (report) Object.assign(report, { archivedAt: null, updatedAt: Date.now() });
  writeState(state);
}
export async function deleteDailyReportPermanently(date: string) {
  const state = readState();
  const report = state.reports.find((item) => item.localDate === date);
  if (!report?.archivedAt) throw new Error("只能永久删除已归档的日报。");
  const included = state.periodicReports.some((item) => item.type === "week" && item.sourceDates.includes(date));
  if (!included) throw new Error("该日报尚未纳入规划周报，不能永久删除。");
  state.reports = state.reports.filter((item) => item.localDate !== date);
  writeState(state);
}
export async function getLearningSettings() {
  return readState().settings;
}
export async function saveLearningSettings(settings: LearningSettings) {
  const state = readState();
  state.settings = settings;
  writeState(state);
}
export async function listLearningDaySummaries(start: string, end: string) {
  const state = readState();
  const dates = new Set<string>();
  state.tasks.forEach((item) => {
    if (item.localDate >= start && item.localDate <= end)
      dates.add(item.localDate);
  });
  state.sessions.forEach((item) => {
    if (item.localDate >= start && item.localDate <= end)
      dates.add(item.localDate);
  });
  state.reports.forEach((item) => {
    if (item.localDate >= start && item.localDate <= end)
      dates.add(item.localDate);
  });
  return [...dates].sort().map((localDate) => {
    const tasks = state.tasks.filter(
      (item) => item.localDate === localDate && item.status !== "cancelled",
    );
    const report = state.reports.find((item) => item.localDate === localDate);
    return {
      localDate,
      taskTotal: tasks.length,
      taskDone: tasks.filter((item) => item.status === "done").length,
      plannedMinutes: tasks.reduce((sum, item) => sum + item.plannedMinutes, 0),
      focusedMinutes: Math.round(
        state.sessions
          .filter(
            (item) =>
              item.localDate === localDate && item.status === "completed",
          )
          .reduce((sum, item) => sum + item.effectiveSeconds, 0) / 60,
      ),
      hasReport: Boolean(report),
      checkedIn: Boolean(report?.completedAt),
    } satisfies LearningDaySummary;
  });
}
export async function getPeriodicLearningReport(
  type: PeriodicLearningReportType,
  start: string,
  end: string,
) {
  return (
    readState().periodicReports.find(
      (report) =>
        report.type === type &&
        report.periodStart === start &&
        report.periodEnd === end,
    ) || null
  );
}
export async function listPeriodicLearningReports(
  type: PeriodicLearningReportType,
  start: string,
  end: string,
) {
  return readState().periodicReports
    .filter((report) => report.type === type && report.periodEnd >= start && report.periodEnd <= end)
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}
export async function savePeriodicLearningReport(
  input: Omit<PeriodicLearningReport, "id" | "createdAt" | "updatedAt">,
) {
  const state = readState();
  const existing = await getPeriodicLearningReport(
    input.type,
    input.periodStart,
    input.periodEnd,
  );
  const now = Date.now();
  const report: PeriodicLearningReport = {
    ...input,
    id: existing?.id || uuid(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  state.periodicReports = [
    ...state.periodicReports.filter(
      (item) =>
        !(
          item.type === input.type &&
          item.periodStart === input.periodStart &&
          item.periodEnd === input.periodEnd
        ),
    ),
    report,
  ];
  writeState(state);
  return report;
}

export async function listLearningScheduleEvents(start: string, end: string) {
  return readState()
    .scheduleEvents.filter(
      (event) => event.localDate >= start && event.localDate <= end,
    )
    .sort(
      (a, b) =>
        a.localDate.localeCompare(b.localDate) ||
        Number(b.allDay) - Number(a.allDay) ||
        (a.startTime || "").localeCompare(b.startTime || ""),
    );
}

export async function saveLearningScheduleEvent(
  input: SaveLearningScheduleEventInput,
  id?: string,
) {
  assertValidLearningScheduleInput(input);
  const state = readState();
  const existing = id
    ? state.scheduleEvents.find((event) => event.id === id)
    : undefined;
  if (id && !existing) throw new Error("要编辑的日程不存在。");
  const now = Date.now();
  const event: LearningScheduleEvent = {
    id: id || uuid(),
    ...input,
    startTime: input.allDay ? null : input.startTime,
    endTime: input.allDay ? null : input.endTime,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  state.scheduleEvents = [
    ...state.scheduleEvents.filter((item) => item.id !== event.id),
    event,
  ];
  writeState(state);
  return event;
}

export async function deleteLearningScheduleEvent(id: string) {
  const state = readState();
  state.scheduleEvents = state.scheduleEvents.filter(
    (event) => event.id !== id,
  );
  writeState(state);
}

export async function listLearningKnowledgeBases() {
  return readState().knowledgeBases;
}
export async function saveLearningKnowledgeBase(
  input: Pick<
    LearningKnowledgeBase,
    "name" | "description" | "goalId" | "source"
  >,
  id?: string,
) {
  const state = readState();
  const existing = id
    ? state.knowledgeBases.find((item) => item.id === id)
    : undefined;
  const now = Date.now();
  const value: LearningKnowledgeBase = {
    id: id || uuid(),
    ...input,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  state.knowledgeBases = [
    ...state.knowledgeBases.filter((item) => item.id !== value.id),
    value,
  ];
  writeState(state);
  return value;
}
export async function deleteLearningKnowledgeBase(id: string) {
  const state = readState();
  const ids = new Set(
    state.knowledgeItems
      .filter((item) => item.knowledgeBaseId === id)
      .map((item) => item.id),
  );
  state.knowledgeBases = state.knowledgeBases.filter((item) => item.id !== id);
  state.knowledgeItems = state.knowledgeItems.filter(
    (item) => item.knowledgeBaseId !== id,
  );
  state.reviewStates = state.reviewStates.filter(
    (item) => !ids.has(item.itemId),
  );
  state.reviewAttempts = state.reviewAttempts.filter(
    (item) => !ids.has(item.itemId),
  );
  writeState(state);
}
export async function listLearningKnowledgeItems(baseId?: string) {
  const items = readState().knowledgeItems;
  return baseId
    ? items.filter((item) => item.knowledgeBaseId === baseId)
    : items;
}
export async function saveLearningKnowledgeItem(
  input: SaveLearningKnowledgeItemInput,
  id?: string,
) {
  const state = readState();
  const existing = id
    ? state.knowledgeItems.find((item) => item.id === id)
    : undefined;
  const now = Date.now();
  const value: LearningKnowledgeItem = {
    id: id || uuid(),
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
  const duplicate = value.externalId
    ? state.knowledgeItems.find(
        (item) =>
          item.externalSource === value.externalSource &&
          item.externalId === value.externalId,
      )
    : undefined;
  if (duplicate && !id) value.id = duplicate.id;
  state.knowledgeItems = [
    ...state.knowledgeItems.filter((item) => item.id !== value.id),
    value,
  ];
  writeState(state);
  return value;
}
export async function deleteLearningKnowledgeItem(id: string) {
  const state = readState();
  state.knowledgeItems = state.knowledgeItems.filter((item) => item.id !== id);
  state.reviewStates = state.reviewStates.filter((item) => item.itemId !== id);
  state.reviewAttempts = state.reviewAttempts.filter(
    (item) => item.itemId !== id,
  );
  writeState(state);
}
export async function listLearningReviewStates() {
  return readState().reviewStates;
}
export async function listLearningReviewAttempts(start?: string, end?: string) {
  return readState().reviewAttempts.filter(
    (item) =>
      !start || !end || (item.localDate >= start && item.localDate <= end),
  );
}
export async function saveLearningReviewAttempt(
  attempt: LearningReviewAttempt,
  reviewState: LearningReviewState,
) {
  const state = readState();
  state.reviewAttempts.push(attempt);
  state.reviewStates = [
    ...state.reviewStates.filter((item) => item.itemId !== reviewState.itemId),
    reviewState,
  ];
  writeState(state);
}
export async function getLearningReviewSettings() {
  return readState().reviewSettings;
}
export async function saveLearningReviewSettings(
  settings: LearningReviewSettings,
) {
  const state = readState();
  state.reviewSettings = settings;
  writeState(state);
}

export { planTasksForDate };
