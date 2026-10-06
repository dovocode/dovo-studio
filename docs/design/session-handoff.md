# Session handoff between runtimes

Status: proposal. This document describes intended behavior, not an implemented feature.
Investigation date: 6 October 2026.

## Outcome

Move an idle coding task to another paired Dovo runtime with the same Git project, preserving its
conversation, files and native provider context where supported. The user chooses **Move to
computer**, selects the destination project, reviews compatibility, and continues there. The source
keeps a read-only history with a link to the destination.

This is an explicit move at a turn boundary. Live process migration, continuous synchronization,
cross-provider conversion and shared concurrent execution are outside this proposal. Both runtimes
must be reachable to complete the move. HTTP remains supported over LAN, Tailscale and NetBird;
HTTPS stays optional. Existing pairing codes and device tokens remain required, with no new account
or hosted identity service.

## Existing foundations and gaps

- [Turn execution](../../packages/runtime/src/agents/execution/run-turn.ts) stores the provider
  session ID and consumed message IDs. Its session fingerprint includes the checkout path, branch
  and effective agent configuration. A mismatch starts a fresh session with conversation replay, so
  importing a source fingerprint unchanged would lose native continuation.
- [Local handoff](../../packages/runtime/src/scm/tasks/task-handoff.ts) moves tasks between the
  project folder and a worktree, with idle checks and preservation of uncommitted changes. It is not
  a cross-runtime transfer API.
- [Provider adapters](../../packages/runtime/src/agents/execution/types.ts) can run, probe and
  discover models, but have no session export/import contract.
- [Usage transcript discovery](../../packages/runtime/src/storage/usage-transcripts.ts) already
  locates Codex and Claude session directories. This reads usage, not complete portable context.
- Workspace import requires an empty destination and restores a whole workspace. It cannot merge one
  task into an existing runtime. Conversation, attachment and artifact storage also need explicit
  per-task export; a client snapshot is not a complete backup.
- Git remote identity can suggest a matching project, but local IDs and paths must be mapped. Never
  infer checkout equivalence from a project name or matching branch name alone.

## Recommended first slice

Build a per-task move for a single Git checkout with clean tracked and untracked state, an exact
committed HEAD available on the destination, and no linked checkouts or delegated task family.
Prepare a new isolated destination worktree instead of changing its project folder.

Support native Claude and Codex transfer only after the compatibility experiments below pass. Each
provider advertises its own transfer capability. A failed or unsupported native import leaves the
move unactivated; the user can explicitly choose conversation replay, with a clear warning that
provider tool history and compacted context may be lost. Never silently downgrade.

The destination must already have a usable provider installation and authentication. Show mismatched
provider versions, unavailable models and missing tools before starting the transfer. Keep the
provider and model unchanged for native continuation; do not silently substitute an agent preset.
Resolve effective instructions and tool configuration using destination paths and local credentials.
Block incompatible native continuation and offer replay explicitly.

Reject active or queued turns, preparing/finalizing work, scheduled continuations, active jobs,
pending approvals/questions and live task terminals. Use the existing admission and checkout locks
and recheck after acquiring them. Frozen tasks must also reject new prompts, edits, jobs and
automatic restart recovery through every execution entry point.

## Transfer contents

A versioned manifest identifies the transfer, source runtime/task, destination runtime/project, new
destination task ID, task revision, repository identity, exact commit, source checkout path,
provider/version, session ID and checksums. The destination's task ID is allocated once per transfer
and reused on retries; source identity remains provenance rather than assuming IDs are global.

Include complete sent messages, relevant task settings and historical turns, attachment bytes,
artifact revisions and opaque provider session files. Read full server-side conversation storage,
not a paged client projection. Remap attachment/artifact ownership and references to the new task.
Keep historical source paths labeled as history; regenerate current file state from the destination
checkout. Old Git checkpoint references must not appear restorable unless their objects were
transferred and validated; mark them unavailable in the first slice.

Exclude device tokens, owner tokens, provider authentication, runtime databases, process locks,
queued input and active execution records. MCP secret references are local to the source runtime;
resolve against destination configuration rather than copying them as usable credentials. Preserve
session content as sensitive data and use existing authenticated runtime access for its transfer.

Validate schemas, format versions, byte limits, checksums and safe relative archive paths before
writing. Permit only allowlisted provider session locations; reject traversal and symlink escapes.
Write staged files atomically and never overwrite an unrelated session with the same ID. Selective
path remapping is provider-specific; do not search-and-replace arbitrary transcript text.

## Ownership, retries and recovery

Use the paired client to coordinate authenticated calls to both runtimes. This avoids requiring
server-to-server reachability or storing the destination device token on the source. Persist
transfer progress on the servers so a client restart can recover it. Proposed operations are
prepare-source, stage-destination, seal-source, activate-destination, status and abort, all keyed by
one transfer ID. Activation uses a source-issued commit proof bound to the immutable manifest and
destination, validated using trust established for this paired transfer. The proof is not a reusable
device token. The first implementation must specify and test this trust exchange before exposing
activation.

1. **Prepare source:** persist a freeze under the task lock, export one stable revision and retain
   the original session. Export only after provider writes have settled. Editing files outside Dovo
   is not stopped by a task lock: recheck Git state and HEAD before sealing.
2. **Stage destination:** validate the package and exact checkout, prepare the worktree and session,
   and return a durable receipt binding the transfer ID and manifest checksum. The imported task
   remains hidden from normal execution and cannot run.
3. **Seal source:** validate the destination receipt and unchanged source state, then durably record
   the destination and permanently relinquish execution for this transfer before issuing the commit
   proof. The source retains history and its session files.
4. **Activate destination:** validate the proof and staged receipt, durably activate the task and
   record completion. The user can then send the next prompt. Do not run an agent as an import side
   effect. Bind the imported native session to a recomputed destination fingerprint only after
   compatibility and load validation pass; retain consumed message IDs for native continuation.
   Replay clears the native session binding and consumed-message tracking explicitly.

Repeated operations return their persisted result; reusing an ID with different contents is
rejected. Before sealing, abort must first durably tombstone the destination staging record, then
unfreeze the source. Serialize abort against seal so they cannot both succeed. After sealing, retry
activation; never unfreeze the source on a timeout or automatically expire ownership. If activation
fails, show a recoverable pending transfer. Moving back is a new handoff, not an undo of an
uncertain move.

This deliberately favors a temporarily blocked task over two executing copies. It does not claim
exactly-once provider actions. Source history follows the same recovery limits as existing turns.

## Native provider context and prior art

The following projects were reviewed through their public documentation and release history; none
was installed or tested during this investigation.

| Reference                                                                      | Relevant behavior                                                                                                                                                             | Use in Dovo                                                                           |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [codex-claude-transfer (cct)](https://github.com/ahmojo/codex-claude-transfer) | Native session bundles, checksums, selective working-directory mapping, undo and optional Codex app-server reconciliation. Initial public release documented on 14 June 2026. | Primary reference for the session package and Codex discovery experiment.             |
| [claude-sesh-mover](https://github.com/Sertelegger/claude-sesh-mover)          | Claude path remapping, incremental export/import and duplicate handling.                                                                                                      | Reference for Claude project mapping and associated session data.                     |
| [codex-session-sync](https://github.com/shonngithub/codex-session-sync)        | Cold WebDAV synchronization with backups and conflict handling; documents rollout, session-index and SQLite stores.                                                           | Storage-layout reference; whole-home synchronization is outside scope.                |
| [codex-workspace-sync](https://github.com/Companionh/codex-workspace-sync)     | Experimental self-hosted synchronization with raw artifacts, checkpoints and single-device leases.                                                                            | Ownership/recovery reference; no lease-expiry takeover in the proposed move protocol. |

**Claude:** [official session documentation](https://code.claude.com/docs/en/agent-sdk/sessions)
documents reading history through SDK functions and restoring a session JSONL file on a new host
before resuming by ID. Use native files rather than reconstructing context from visible messages.
Verify compacted sessions, tool results, subagent transcript dependencies and any associated files
needed for continuation; the documented primary-file move alone does not establish all of these.

**Codex:** [official app-server documentation](https://learn.chatgpt.com/docs/app-server) exposes
thread read and resume, but does not establish a stable cross-host export/import contract.
[cct internals](https://github.com/ahmojo/codex-claude-transfer/blob/Main/docs/internals.md)
describe copying rollout files, then delegating index discovery to Codex's own app-server with
thread list/read and verification. Do not copy a live SQLite database or edit its thread table. The
project's [compatibility table](https://github.com/ahmojo/codex-claude-transfer#compatibility)
reports testing against Codex 0.144.6 and Claude 2.1.212 in July 2026; this is precedent, not
verification of Dovo's installed versions. Preserving visible turns alone does not prove compacted
model context survives.

**OpenCode:** [native CLI commands](https://opencode.ai/v2/docs/cli/commands/) document session
export/import and selecting a destination directory. Evaluate this in a follow-up against both
OpenCode adapter variants; advertised commands do not guarantee compatibility with every installed
version. Other providers remain replay-only until independently verified.

Use these implementations as references first. Do not add a CLI dependency or copy source code until
its integration, versioning and license implications have been assessed.

## Validation and delivery

Before implementing native transfer, use synthetic sessions in isolated provider homes on two
different checkout paths. Record installed versions and test ordinary history, tool-call/results,
compaction, attachments and a next turn that depends on pre-handoff context. Validate loading
without starting a new turn where supported. A successful transcript read is not enough: a
controlled next turn must demonstrate continuation. If a provider requires all its processes to
close for export, surface that limitation rather than terminating unrelated sessions.

Then implement protocol schemas, durable transfer admission/state and client coordination; follow
with Git checkout preparation, task/storage remapping, provider import and shared desktop/web/mobile
actions. Keep ownership in the runtime, wire schemas in protocol and task UI in the owning
extension.

Required verification includes interrupted uploads, invalid bundles, conflicting IDs, repeated
calls, concurrent sends/jobs, source edits during export, process crashes before and after seal,
lost activation responses, client restart, abort/seal races, offline destinations and HTTP with
paired device authentication. Every recovery case must leave at most one executable task and
preserve the original data. Run targeted runtime/protocol tests and an end-to-end two-runtime
handoff.

After the clean-checkout slice works, add dirty checkout transfer using Git bundles for missing
commits plus a complete staged/unstaged/untracked snapshot. Preserve binary files, executable bits
and index state; the UI's text diff is not a transfer format. Explicitly handle or reject submodule
and LFS requirements. Never create or push a user commit implicitly. Linked checkouts and task
families follow only when all participating projects can be mapped and transferred consistently.

Approval of this proposal selects the direction. Native provider compatibility, commit-proof trust
exchange and end-to-end recovery remain implementation gates, not claims of completed behavior.
