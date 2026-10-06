# Session handoff between runtimes

Status: clean-checkout handoff implemented in the accompanying PR. Native context transfer is
experimental; the validation limits below remain explicit. Investigation date: 6 October 2026.

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
- [Provider adapters](../../packages/runtime/src/agents/execution/types.ts) now close an idle task
  transport before export.
  [Native session transfer](../../packages/runtime/src/agents/transfer/native-session.ts) exports
  Codex rollouts and Claude transcripts plus session sidecars.
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

The implemented slice supports experimental native Claude and Codex transfer with identical CLI
versions and destination load validation. A failed or unsupported native import leaves the move
unactivated; the user can explicitly choose conversation replay, with a clear warning that provider
tool history and compacted context may be lost. Never silently downgrade.

The destination must already have a usable provider installation and authentication. The UI lists
agents with the same provider and model. Version and native-load checks happen during staging; an
error leaves the source frozen until retry or cancellation. Destination authentication and
configured tools must already be usable; the transfer does not log in or probe every tool. Keep the
provider and model unchanged for native continuation; do not silently substitute an agent preset.
Resolve effective instructions and tool configuration using destination paths and local credentials.
Block incompatible native continuation and offer replay explicitly.

Reject active or queued turns, preparing/finalizing work, scheduled continuations, active jobs,
pending approvals/questions and live task terminals. Use the existing admission and checkout locks
and recheck after acquiring them. Frozen tasks must also reject new prompts, edits, jobs and
automatic restart recovery through every execution entry point.

## Transfer contents

A versioned manifest identifies the transfer, source runtime/task, destination runtime/project, new
destination task ID, repository identity, exact commit, source checkout path, provider/version,
session ID and checksums. The destination's task ID is allocated once per transfer and reused on
retries; source identity remains provenance rather than assuming IDs are global.

Include complete sent messages, relevant task settings and historical turns, attachment bytes,
artifact revisions and opaque provider session files. Read full server-side conversation storage,
not a paged client projection. Remap attachment/artifact IDs and ownership to the new task.
Historical text and opaque provider context retain old references; regenerated artifact tiles use
local IDs, and the first resumed prompt tells the agent to re-list artifacts and attachments. Keep
historical source paths labeled as history; regenerate current file state from the destination
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
transfer progress on the servers so a client restart can recover it. The `/api/tasks/transfer/*`
operations are prepare, stage, seal, activate, status, read, begin-abort, abort and abort-source,
all keyed by one transfer ID. Activation uses a source-issued commit proof bound to the immutable
manifest and destination. Preparation generates random activation and cancellation secrets and
exports only their SHA-256 hashes. The source releases the activation secret only after persisting
`sealed`; the destination verifies its hash and receipt before activation. The paired client
authenticates independently to both runtimes. Neither secret is a reusable device token.

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
rejected. Before sealing, cancellation first persists `aborting` on the source and obtains a
separate cancellation proof, then durably tombstones the destination, then unfreezes the source.
Source cancellation and sealing share serialization, so both secrets cannot be released.
Cancellation removes unchanged native files owned by staging, but retains the worktree and branch to
avoid deleting project data. Modified native files are also retained. After sealing, retry
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

## Validation and limits

The implementation has automated two-runtime tests using real Git, SQLite and authenticated HTTP:
prepare/stage/seal/activate, round trips with independent attachments and artifact revisions,
repeated calls after reconstructed transfer managers, rejected unauthenticated access, malformed
attachment rejection before sealing, source checkout edits, cancellation tombstones and blocked
source editing/queue admission. A native Claude fixture is loaded by the real SDK history reader; a
destination-runner test confirms the imported session ID and consumed messages reach the next turn
without conversation replay. A Codex fixture preserves opaque compaction data and verifies that
import calls only initialize and thread/resume. Browser checks exercise project/agent choices,
visible network failure, stable retry IDs and destination navigation.

An additional isolated local experiment imported and re-exported a synthetic rollout through the
installed **Codex CLI 0.160.1** app-server. The **Claude SDK 0.3.288** reader loads transferred
synthetic history and sidecars. These checks do **not** verify a billed live-model response, real
compacted-context reasoning, every historical CLI format, full process-crash durability, or native
iOS interaction. Native transfer remains experimental, rejects differing CLI versions and fails
explicitly if destination context cannot be loaded; it never silently falls back to replay.

Current product limits:

- Both computers must be paired and reachable. The destination already needs the same Git remote,
  exact source commit, provider and model. Dovo never fetches, commits or pushes implicitly.
- Only clean single-checkout tasks with sent history can move. Queues, scheduled continuations,
  child task families, linked projects, active terminals, jobs and pending interactions must finish
  first. Pull-request/work-item tasks, archived tasks, submodules and LFS projects are excluded.
- The package is at most 64 MB; native files total at most 32 MB. Codex supports ordinary
  `sessions/` rollouts, not archived rollouts. Claude paths above 200 encoded characters are
  rejected.
- Ignored files, installed dependencies, machine processes, source checkpoint restore data and
  provider credentials are not copied. Destination task defaults supply local setup commands; normal
  worktree setup runs when the next turn starts.
- Changing destination agent settings after staging blocks activation until those settings are
  restored. A sealed source cannot be unlocked; reconnect and retry **Complete move**. To move back,
  start a new transfer from the destination.
- Durable transfer records retain the package in the local runtime database. Automatic transfer
  record cleanup and a browser-only local export/import flow are not part of this slice.

Follow-ups are dirty-checkout snapshots and Git bundles for missing commits, additional provider
import contracts, broader real-model/compaction compatibility testing, and mapped linked checkouts.
