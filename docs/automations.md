# Automations

Jobs run on the selected computer. The runtime must stay running for schedules, webhooks and task
execution; closing the phone or desktop client does not stop a run.

## Create and edit on mobile

Open **Settings → Coding → Automations**, select the computer, then **New automation**. Give it a
name, choose a trigger and configure its ordered steps:

- **Task:** instructions, project, harness, model, thinking level, permissions and local checkout or
  new worktree. Built-in providers and installed ACP agents work directly; a saved agent
  configuration is optional.
- **Review:** pause for approval before the next step. Open the preceding task to inspect its chat
  and changes, then approve or reject the run.
- Reorder or remove steps in the editor. At least one task and one trigger are required.

Schedules support common presets or a custom cron expression and time zone. The saved time zone
controls the schedule even when the phone travels. Webhook credentials are configured on the host
desktop; paired phones do not gain access to owner-only credentials.

New automations have automatic triggers paused. Save and run one manually before enabling its
schedule or webhook. Editing an existing automation updates future runs; an active or failed run
keeps the step definitions it started with. Mobile edits use compare-and-set writes: conflicting
desktop edits are reported instead of overwritten.

The mobile editor supports a single ordered path. Existing branching graphs remain visible and
runnable, and their connections are preserved. Edit those in the desktop/web canvas.

## GitHub event triggers

Select **GitHub event** on the trigger node (desktop/web) or in the mobile editor. Enter the GitHub
hostname and `owner/repository`, then choose an event:

- Issues: created, comment, assigned, labeled.
- Pull requests: opened, assigned, labeled, merged, ready for review, review requested, review
  submitted, synchronized, review comment, timeline comment.
- Discussions: opened, updated, comment (including replies).
- Sub-issues: added to a parent issue.

Optional filters select a current label or the triggering actor's login. **Require actor write
access** checks the actor's current repository permission before accepting an event. The event's
repository, item, actor and details are included as external context in each task's instructions.
Task projects, harnesses, permissions, linked checkouts and review gates work as usual.

The selected computer polls once a minute using its configured GitHub CLI and existing `gh` login.
Run `gh auth login --hostname <host>` on that computer if needed. GitHub event triggers work with
LAN/VPN runtimes without an incoming public webhook or a Dovo account. Authentication and API errors
appear in runtime activity; polling shares SCM's GitHub rate-limit controls.

Enabling a trigger starts with new events, without running through historical issues or PRs. While
it remains enabled, its polling progress and pending events survive a restart. Events discovered
after downtime are caught up, and events wait when another run is active or awaiting review.
Accepted deliveries are deduplicated across restarts. Disabling the trigger clears pending external
events; changing its GitHub settings starts a fresh observation window. Active runs continue with
the configuration they started with.

Polling observes changes rather than receiving every webhook. Discussion updates use the latest edit
and editor. PR synchronization compares head commits after the first observation; multiple pushes
between polls are combined, and GitHub does not expose the pusher through this comparison, so
actor/write-access filters are unavailable for synchronization. Multiple discussion edits between
polls are likewise combined. Label filters use the item's labels at polling time.

## Follow a run

Each run records the current step, completed steps, review gates, failures, task links and start/end
times. Expand run details on mobile or open **Runs** beside the desktop canvas. Steps distinguish
queued work from work that is running, awaiting review, completed, failed or cancelled.

Only one run of an automation may be active or waiting for review at a time. Different automations
may run concurrently, subject to the existing task checkout lock. A task using a new worktree has
its own checkout; tasks sharing a local checkout must wait for the other task to finish.

## Retry and stop

**Retry** resumes a failed or cancelled run. It preserves completed steps and reuses the unfinished
step's task, conversation and checkout. A review that was rejected must be approved again before
execution can continue. Retry waits for cancellation to finish and refuses to overlap another run of
the same automation.

Retry does not roll back files or guarantee that an interrupted tool command had no effect. Inspect
the failed task's output and changes when the error happened during an external action. Retrying
uses the original run configuration; to use edited instructions, start a new run.

**Cancel** stops the current task and prevents later steps from starting. After a runtime restart,
interrupted runs are marked failed with an explicit recovery message. Retry reconciles tasks that
already completed before the run saved its next step, avoiding an unnecessary second execution.
Waiting review gates survive restarts.

## Delivery and scheduling

Manual starts accept an optional `requestId` at `POST /api/jobs/run`. Repeating an accepted request
for the same automation returns its original run ID, including after restart. Clients retain the ID
after a lost response so retrying the request does not create a second run.

Webhooks require a credential and unique `X-Idempotency-Key`. Duplicate deliveries return HTTP 409.
Delivery acceptance and run creation commit together. Retry an existing run with
`POST /api/jobs/retry` and `{ "id": "run-id" }`.

Schedules do not replay downtime. Missed ticks while the runtime is running are coalesced, and
overlapping runs are skipped. Invalid schedules are isolated so they do not stop other automations.

## Multiple projects in a task step

Task steps can include **Linked projects** on the same computer. Each link selects a main checkout,
an existing worktree, or a new worktree, with reference-only or edit access. New worktrees have
unique branch suffixes per task, so separate automation runs do not reuse each other's checkout.
Existing worktrees and main checkouts are intentionally reused; concurrent editing is blocked.

The primary project supplies agent defaults and tools. Each linked project's own worktree setup
command runs before execution. Editable Git checkouts have separate checkpoint files and can be
reviewed from the thread's Changes project selector. Reference-only is conveyed through harness
permissions and instructions; it is not an operating-system sandbox.

New step threads use the normal title generator with their submitted instructions. Generation runs
independently of the task; a failure keeps the step name, and a manually edited title is preserved.
