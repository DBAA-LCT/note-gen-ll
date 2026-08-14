import assert from "node:assert/strict";
import test from "node:test";
import {
  ActiveSyncPaths,
  hasRemoteFileContent,
  shouldRecordSuccessfulSync,
  shouldAutoApplyRemote,
} from "./sync-logic.ts";

test("tracks different syncing files independently", () => {
  const active = new ActiveSyncPaths();
  assert.equal(active.begin("a.md"), true);
  assert.equal(active.begin("b.md"), true);
  assert.equal(active.begin("a.md"), false);
  assert.equal(active.size, 2);
  active.end("a.md");
  assert.equal(active.size, 1);
  active.end("b.md");
  assert.equal(active.size, 0);
});

test("treats an empty remote file as valid content", () => {
  assert.equal(hasRemoteFileContent(""), true);
  assert.equal(hasRemoteFileContent(undefined), false);
});

test("records sync metadata only after success", () => {
  assert.equal(shouldRecordSuccessfulSync({ success: true }), true);
  assert.equal(shouldRecordSuccessfulSync({ success: false }), false);
});

test("never auto-applies a remote version during a conflict", () => {
  assert.equal(shouldAutoApplyRemote("pull"), true);
  assert.equal(shouldAutoApplyRemote("conflict"), false);
});
