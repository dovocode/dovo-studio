# Automations

Jobs run on the selected computer. The runtime must stay running for schedules, webhooks and task
execution; closing the phone or desktop client does not stop a run.

## Create and edit on mobile

Open **Automations**, select the computer, then **New automation**. Give it a name, choose a trigger
and configure its ordered steps:

- **Task:** instructions, project, saved agent and local checkout or new worktree.
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
