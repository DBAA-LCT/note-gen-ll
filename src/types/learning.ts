export type LearningGoalStatus =
  "planned" | "active" | "completed" | "archived" | "deleted";
export type LearningTaskStatus = "todo" | "in-progress" | "done" | "cancelled";
export type LearningTaskSource = "local-rule" | "ai" | "manual";
export type LearningExecutionStatus = "done" | "partial" | "not-done";
export type FocusSessionStatus =
  "running" | "paused" | "completed" | "cancelled";

export interface LearningGoal {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  weeklyDays: number[];
  timeWeight: number;
  color: string;
  note: string;
  planMarkdown: string;
  status: LearningGoalStatus;
  progressPercent: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface LearningTask {
  id: string;
  goalId: string | null;
  notePath: string | null;
  goalTitle?: string;
  goalColor?: string;
  localDate: string;
  title: string;
  description: string;
  completionCriteria: string;
  plannedMinutes: number;
  progressPercent: number;
  status: LearningTaskStatus;
  source: LearningTaskSource;
  generationNote: string;
  generatedFromDate: string | null;
  generationKey: string | null;
  manuallyEdited: boolean;
  scheduledStart: number | null;
  scheduledEnd: number | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface FocusSession {
  id: string;
  taskId: string | null;
  taskIds: string[];
  goalId: string | null;
  localDate: string;
  startedAt: number;
  endedAt: number | null;
  effectiveSeconds: number;
  status: FocusSessionStatus;
  createdAt: number;
  updatedAt: number;
}

export interface DailyReportGoalEntry {
  goalId: string;
  goalTitle: string;
  status: LearningExecutionStatus;
  progressPercent: number;
  studyMinutes: number;
  content: string;
}

export interface DailyReflection {
  energyLevel: number | null;
  focusLevel: number | null;
  biggestWin: string;
  biggestBlocker: string;
  nextIntention: string;
}

export interface DailyReport {
  localDate: string;
  overall: string;
  reflection: DailyReflection;
  entries: DailyReportGoalEntry[];
  markdownPath: string | null;
  completedAt: number | null;
  archivedAt: number | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface LearningDaySummary {
  localDate: string;
  taskTotal: number;
  taskDone: number;
  plannedMinutes: number;
  focusedMinutes: number;
  hasReport: boolean;
  checkedIn: boolean;
}

export type LearningScheduleEventKind = "schedule" | "milestone";

export interface LearningScheduleEvent {
  id: string;
  title: string;
  localDate: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  kind: LearningScheduleEventKind;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface SaveLearningScheduleEventInput {
  title: string;
  localDate: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  kind: LearningScheduleEventKind;
  notes: string;
}

export type PeriodicLearningReportType = "week" | "month";

export interface PeriodicLearningReportMetrics {
  focusedMinutes: number;
  taskTotal: number;
  taskDone: number;
  studyDays: number;
  reportDays: number;
}

export interface PeriodicLearningReport {
  id: string;
  type: PeriodicLearningReportType;
  periodStart: string;
  periodEnd: string;
  title: string;
  content: string;
  metrics: PeriodicLearningReportMetrics;
  sourceDates: string[];
  createdAt: number;
  updatedAt: number;
}

export interface LearningSettings {
  dailyStudyMinutes: number;
  timeZone: string;
  weeklyDays: number[];
  autoCompleteGoals: boolean;
  reportDirectory: string;
}

export type LearningItemType = "word" | "concept" | "formula";
export type LearningKnowledgeSource =
  "notegen" | "maimemo-words" | "maimemo-markji";

export interface LearningKnowledgeBase {
  id: string;
  name: string;
  description: string;
  goalId: string | null;
  source: LearningKnowledgeSource;
  createdAt: number;
  updatedAt: number;
}

export interface LearningKnowledgeItem {
  id: string;
  knowledgeBaseId: string;
  type: LearningItemType;
  prompt: string;
  answer: string;
  aliases: string[];
  tags: string[];
  explanation: string;
  notePath: string | null;
  externalId: string | null;
  externalSource: LearningKnowledgeSource | null;
  gradingMode: "answer" | "self";
  createdAt: number;
  updatedAt: number;
}

export interface LearningReviewState {
  itemId: string;
  dueDate: string;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  mastery: number;
  lastReviewedAt: number | null;
}

export interface LearningReviewAttempt {
  id: string;
  itemId: string;
  localDate: string;
  userAnswer: string;
  grade: 0 | 1 | 2 | 3;
  correct: boolean;
  feedback: string;
  createdAt: number;
}

export interface LearningReviewSettings {
  enabled: boolean;
  dailyCount: number;
  knowledgeBaseIds: string[];
  itemTypes: LearningItemType[];
  maimemoTodayPercent: number;
}

export interface SaveLearningKnowledgeItemInput {
  knowledgeBaseId: string;
  type: LearningItemType;
  prompt: string;
  answer: string;
  aliases?: string[];
  tags?: string[];
  explanation?: string;
  notePath?: string | null;
  externalId?: string | null;
  externalSource?: LearningKnowledgeSource | null;
  gradingMode?: "answer" | "self";
}

export interface CreateLearningGoalInput {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  weeklyDays: number[];
  timeWeight: number;
  color: string;
  note: string;
  planMarkdown: string;
}

export interface UpdateLearningTaskInput {
  title: string;
  description: string;
  completionCriteria: string;
  plannedMinutes: number;
  progressPercent: number;
}

export interface AiLearningTaskDraft {
  goalId: string;
  title: string;
  description: string;
  completionCriteria: string;
  plannedMinutes: number;
}

export interface SaveDailyReportInput {
  localDate: string;
  overall: string;
  reflection: DailyReflection;
  entries: DailyReportGoalEntry[];
  markdownPath?: string | null;
  completedAt?: number | null;
}

export const DEFAULT_LEARNING_SETTINGS: LearningSettings = {
  dailyStudyMinutes: 120,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
  weeklyDays: [1, 2, 3, 4, 5, 6, 0],
  autoCompleteGoals: false,
  reportDirectory: "规划报告/日报",
};

export const DEFAULT_REVIEW_SETTINGS: LearningReviewSettings = {
  enabled: true,
  dailyCount: 10,
  knowledgeBaseIds: [],
  itemTypes: ["word", "concept", "formula"],
  maimemoTodayPercent: 60,
};
