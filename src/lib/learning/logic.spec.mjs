import assert from "node:assert/strict";
import test from "node:test";
import {
  assertValidLearningGoalInput,
  assertValidDailyReportInput,
  assertValidLearningScheduleInput,
  allocateWeightedMinutes,
  createLatestRequestGuard,
  isValidLocalDate,
  shouldRestoreGeneratedTask,
  taskStateForProgress,
} from "./logic.ts";

const validGoal = {
  title: "完成线性代数",
  startDate: "2026-08-14",
  endDate: "2026-09-14",
  timeZone: "Asia/Shanghai",
  weeklyDays: [1, 3, 5],
  timeWeight: 2,
};

test("validates real calendar dates and goal ranges", () => {
  assert.equal(isValidLocalDate("2024-02-29"), true);
  assert.equal(isValidLocalDate("2026-02-29"), false);
  assert.doesNotThrow(() => assertValidLearningGoalInput(validGoal));
  assert.throws(
    () => assertValidLearningGoalInput({ ...validGoal, endDate: "2026-08-13" }),
    /结束日期/,
  );
  assert.throws(
    () => assertValidLearningGoalInput({ ...validGoal, weeklyDays: [7] }),
    /执行日/,
  );
});

test("rejects invalid timed schedules but accepts all-day events", () => {
  assert.doesNotThrow(() => assertValidLearningScheduleInput({
    title: "里程碑",
    localDate: "2026-08-14",
    startTime: null,
    endTime: null,
    allDay: true,
  }));
  assert.throws(() => assertValidLearningScheduleInput({
    title: "倒置日程",
    localDate: "2026-08-14",
    startTime: "11:00",
    endTime: "10:00",
    allDay: false,
  }), /结束时间/);
});

test("keeps progress and task status consistent", () => {
  assert.deepEqual(taskStateForProgress(-5), { progressPercent: 0, status: "todo" });
  assert.deepEqual(taskStateForProgress(45.6), { progressPercent: 46, status: "in-progress" });
  assert.deepEqual(taskStateForProgress(120), { progressPercent: 100, status: "done" });
});

test("rejects duplicate goals and invalid progress in daily reports", () => {
  assert.throws(() => assertValidDailyReportInput({
    localDate: "2026-08-14",
    entries: [
      { goalId: "g1", progressPercent: 20, studyMinutes: 30 },
      { goalId: "g1", progressPercent: 25, studyMinutes: 10 },
    ],
  }), /重复/);
  assert.throws(() => assertValidDailyReportInput({
    localDate: "2026-08-14",
    entries: [{ goalId: "g1", progressPercent: 101, studyMinutes: 30 }],
  }), /0 到 100/);
});

test("only the latest asynchronous date request may commit", () => {
  const guard = createLatestRequestGuard();
  const first = guard.begin();
  const second = guard.begin();
  assert.equal(guard.isLatest(first), false);
  assert.equal(guard.isLatest(second), true);
});

test("weighted planning never exceeds the configured daily budget", () => {
  const goals = Array.from({ length: 20 }, (_, index) => ({
    id: String(index),
    timeWeight: 1,
    createdAt: index,
  }));
  const allocations = allocateWeightedMinutes(goals, 15);
  assert.equal([...allocations.values()].reduce((sum, value) => sum + value, 0), 15);
  assert.equal([...allocations.values()].filter((value) => value === 0).length, 5);
});

test("restores only system-cancelled generated tasks", () => {
  assert.equal(shouldRestoreGeneratedTask({ status: "cancelled", manuallyEdited: false }), true);
  assert.equal(shouldRestoreGeneratedTask({ status: "cancelled", manuallyEdited: true }), false);
  assert.equal(shouldRestoreGeneratedTask({ status: "done", manuallyEdited: false }), false);
});
