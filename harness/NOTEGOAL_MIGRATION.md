# NoteGoal DeepSeek Harness migration

Upstream source: `deepseek-ai/deepseek-harness`, audited and imported from commit
`47f943859bef60e4160492346772ded9b24f765a` under the MIT license. The source is
part of this repository; NoteGoal does not embed the upstream Web application,
an iframe, or a separately installed DeepSeek application.

## Runtime shape

- `packages/`, `vendor/`, `apps/cli/` and the upstream build scripts are the
  merged Harness source tree.
- `packages/bundle/notegoal-sidecar/` composes the NoteGoal deployment over
  `dsh-base` and exposes it through the upstream stdio JSON-RPC server.
- `src-tauri/src/deepseek_harness.rs` owns the process, request multiplexing,
  event forwarding, model settings and shutdown.
- `src/lib/deepseek-harness/client.ts` turns that transport into the native
  sidebar runtime client.
- `scripts/package-harness-sidecar.mjs` produces the production dependency
  closure and bundles a private Node runtime with the application.

## Capability matrix

| Capability | Source migrated | Runtime composed | Native sidebar wired |
| --- | --- | --- | --- |
| Agent loop, LLM streaming, durable session events | yes | yes | yes |
| Filesystem read/search/edit and observation policy | yes | yes | event cards |
| PowerShell/Bash, sandbox, approvals, background jobs | yes | yes | event cards; approval protocol pending |
| Skills and repository instructions | yes | yes | existing Skills entry; catalog UI pending |
| Plan, goals, todos, compaction | yes | yes | event stream; dedicated panels pending |
| Subagents, follow-up, fork and workflow | yes | yes | lifecycle stream; controls pending |
| Web search | yes | yes | event cards; provider settings pending |
| Code runtime | yes | yes | event cards |
| Scheduled prompts | yes | yes | schedule management UI pending |
| LSP | yes | registry/tool composed | server configuration UI pending |
| MCP | yes | per-server dynamic rows pending | configuration bridge pending |
| Persistent PTY terminal | yes | Unix; Windows uses PowerShell/jobs | terminal panel pending |
| Attachments/images | yes | storage composed | SDK upload method pending |
| User questions and approvals | yes | service composed | bidirectional SDK methods pending |
| Upstream browser UI | source packages retained | intentionally not embedded | being reimplemented as NoteGoal sidebar |

“Source migrated” does not by itself mean a capability is user-complete. The
last two columns are the acceptance boundary: a feature is complete only after
it is composed, reachable through the sidecar protocol, represented in the
native sidebar, and covered by an integration test.
