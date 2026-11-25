# Automations

Jobs run on the selected computer. The runtime must stay running for schedules, webhooks and task
execution; closing the phone or desktop client does not stop a run.

On desktop and web, select the plus icon in the Automations header to create an automation.

## Cost limits and automatic pauses

A cost-only limit needs a known model price before an unattended worker starts. Set the price in
**Usage & limits**, or add a time or token limit. An explicit price of zero is valid. A missing
price means unknown cost. Runtime budget checks and run audits use the same price rules as Usage.
Audits label incomplete cost as **Cost unknown** and show only the priced subtotal. If a provider
switches to an unpriced model, a cost-only run stops when that completed usage arrives. Limits are
best effort because providers can report usage late.

When an agent pauses its own automation, **Paused by an automation run** links to the responsible
run and its saved result. The runtime checks that the worker and run belong to that automation.
Deleted runs show **Responsible run unavailable**. Resume or a later edit removes the current pause
label. Change history keeps the source. Older runtimes keep their existing source display.

## Create and edit on mobile

The Automations list keeps saved rows visible if a computer goes offline. It names the affected
computer and offers a retry when data could not load. If a search has no matches, clear the search
to see the available rows. The first-use action appears when the connected computers finish loading.
Choose **Needs attention** to find failed runs and runs waiting for input. **View run** opens the
affected run on its computer. **Triggers paused** describes the trigger policy. The current or last
run has its own status.

Open **Settings → Coding → Automations**, select the computer, then **New automation**. Give it a
name, choose a trigger and configure its ordered steps:

- **Task:** instructions, project, harness, model, thinking level, permissions and local checkout or
  new worktree. Built-in providers and installed ACP agents work directly; a saved agent
  configuration is optional.
- **Review:** pause for approval before the next step. Open the preceding task to inspect its chat
  and changes, then approve or reject the run.
- Reorder or remove steps in the editor. At least one task and one trigger are required.

A **Review** step can include instructions and an HTTP or HTTPS link. Choose **Require a reason for
the decision** when the reviewer needs to explain an approval or rejection. The run shows the saved
decision, reason, reviewer, and time. Agents can set `data.reviewPrompt` with `instructions`,
`link`, and `requireReason` when the runtime supports review prompts.

For a one-time reminder or task, choose **One time**, enter the date, time and time zone, and enable
the trigger after saving. Put the reminder or work to perform in a Task step. It runs once at that
time, or when the runtime next starts if the computer was offline. It waits if another run is
active. Once accepted, its trigger turns off; follow completion in Runs. Restarting or enabling the
same date again does not repeat it, even after run history expires. Choose a new date for another
reminder. Manual runs and retries remain available.

Schedules support common presets or a custom cron expression and time zone. The saved time zone
controls the schedule even when the phone travels. Webhook credentials are configured on the host
desktop; paired phones do not gain access to owner-only credentials.

New automations have automatic triggers paused. Save and run one manually before enabling its
schedule or webhook. Editing an existing automation updates future runs; an active or failed run
keeps the step definitions it started with. Mobile edits use compare-and-set writes: conflicting
desktop edits are reported instead of overwritten.

The mobile editor supports a single ordered path. Existing branching graphs remain visible and
runnable, and their connections are preserved. Edit those in the desktop/web canvas.

## Validate a step result

Enter a JSON Schema object in **Result schema (optional)** on a Task step. For a step that must
return a count, enter
`{"type":"object","properties":{"count":{"type":"integer"}},"required":["count"]}`. The runtime
supports draft 2020-12 and draft-07. Include `$schema` to select draft-07. Clear the field to use
plain text. An older runtime shows an update message in the editor.

The worker returns one JSON value in its final reply, with any files attached separately. If the
JSON is missing, invalid, over 32 KiB, or fails validation, the step fails and later steps wait.
Retry starts a new worker when the previous attempt already ran a turn and cannot resume it. The
previous worker thread stays available for review. A later manual reply cannot supply the step
result.

Select the preceding task under **Inputs from preceding tasks** to pass its saved JSON to the next
task. File copying still uses **Include files**. Open the run audit and select **Load output for
this page** on the first page to see the redacted JSON and its step, worker, attempt and turn IDs.
Agents can set `data.resultSchema` in a task node through `studio_automations` and use `validate` or
`dryRun` to check the definition. In **Dry run**, enter a JSON object in **Sample step results**
with step IDs as keys, for example `{"count-step":{"count":7}}`. The runtime validates each reached
sample against the worker's schema and passes it to tasks that select that step as an input. A
schema error stops the simulation at that step. Saved scenarios keep the sample values.

## Wait for CI

Add **Wait for CI** and select the GitHub project. Paste a GitHub Actions URL ending in
`/actions/runs/<run-id>/attempts/<attempt-number>`. For a routine that handles a different run each
time, choose a preceding task as the attempt source. Set that task's result schema to
`{"type":"string"}` and have it return the full attempt URL as a JSON string.

Enter a timeout from one minute to 24 hours. The runtime reads the exact attempt through the
selected project's GitHub connection. A successful attempt continues the automation. A failed
attempt or an expired deadline fails the step. A runtime restart keeps the original attempt and
deadline. **Cancel run** stops waiting and leaves GitHub Actions running. Retrying keeps completed
steps and starts a new timeout for the same attempt. Use **Dry run** to simulate both outcomes
without contacting GitHub.

Clients offer the step when the runtime advertises `automationPipelineWaitSupported`. An older
client can still open the automation, but needs updating to edit its CI gate. Finish or cancel
active CI waits and pause automations with CI gates before rolling back to a runtime that does not
support them.

## Run a step in a Bot

A task step with `botId` creates an isolated worker with that [Bot](bots.md)'s settings. Set
`data.objective` to the worker's instructions. The worker reports its result to the Bot and keeps
the coordinator available. A paused Bot fails the step without queueing work. Resume the Bot and
retry the run. Retained legacy runs can still wait for a message in the shared Bot thread.

### Suggest a routine from a message

Open a Bot thread and choose **Suggest a routine** on one of your messages. Dovo prefills the
instructions and recognizes explicit times such as “every Friday at 09:00.” Review the time zone and
the next scheduled time. Enter a schedule when the message leaves the timing open.

Choose **Save paused routine** to save it on the Bot's computer. Open **Dry run** to inspect its
inputs, or choose **Test run** to start real work. Enable triggers when you are ready for the
schedule. Cancel closes the editor without creating a routine. The change history links back to the
owner message. The runtime advertises `routineSuggestionsSupported`.

## Delete an automation

On desktop/web, open the automation’s **Automation actions → Delete automation** menu. On mobile,
open the automation and choose **Delete automation**. Confirm while connected to its computer.
Deletion is blocked until active runs and their threads have stopped. It removes the saved
configuration, future triggers and webhook credential; existing threads and stored run history
remain.

## Find runs about an issue, pull request or thread

Open **Automation runs** on an issue, pull request, or the thread's Agents panel. Choose a result to
open the exact retained run. GitHub-triggered runs use the issue or pull request URL. Runs started
from a reviewed action use the source thread. The list shows runs on the selected computer.

For manual runs through `studio_automations`, pass a `subject` with `kind: "url"` and `url`, or
`kind: "thread"` and `threadId`. Use `runsBySubject` to search that computer, or add the subject to
`runs` to filter one automation.

## Run a manual automation with an MCP event

An agent can preview and run a saved Manual automation using an unread
[MCP event](mcp-apps.md#subscribe-to-mcp-events-from-a-thread) from its active thread. The event and
automation must be on the same computer. The run shows the event name and source server on desktop,
web, and mobile. To inspect the redacted event, load output for the first page of the run audit.
Review steps still require a person. A preview never starts work, and a manual run leaves automatic
triggers paused.

## Start a Bot automation from an MCP event

Choose **MCP event** as the trigger and use the same Bot for every task step. Enter the exact server
name from that Bot's MCP resources, the event name, and the subscription arguments as JSON. For this
trigger, the server must use native HTTP with **MCP-over-ACP** enabled and advertise **poll**
delivery for the event. Try a dry run before enabling the trigger. Add a Review step where a person
should inspect the input before work continues.

The runtime polls while the trigger is enabled, even with the clients closed. A server's polling
interval starts after its response. Events wait while a run is active or awaiting review. The saved
cursor and pending batch survive a runtime restart. Run receipts prevent repeated deliveries while
the receipts are retained. Pausing or changing the trigger clears its pending events and starts a
new observation window when enabled again. The run details show the event source. The first page of
the run audit can load redacted event input.

An agent can use `studio_automations` with `action: "eventStatus"` and the automation ID to inspect
the pending count, next poll, replay support, and reported gaps. A replay gap means some upstream
events may have been missed. The runtime also records it in activity.

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

## Test with a dry run

A dry run tests an automation with sample data. It starts no work and changes nothing.

On desktop/web, open the automation and choose **Dry run**. It tests the current canvas. On mobile,
open the automation, tap its settings button, then choose **Dry run** at the end of the editor. It
tests the unsaved draft.

1. Check the sample trigger data. Dovo fills in a sample for each trigger:
   - Webhook: a small JSON body. Paste a real payload to test your instructions with it.
   - GitHub event: an event for the saved repository, event and actor.
   - Schedule or one time: the next due time.
   - Monitored source: sample content. Choose **Unchanged** to test the path where an automatic run
     ends without work.
2. Optional: under **Simulated outcome**, choose a task that fails or a review that rejects.
3. Choose **Start dry run**.

The result lists each step in the order a real run reaches it:

- **Ran:** the step ran for real. Only the trigger runs. It reads the sample data and applies the
  GitHub actor filter.
- **Simulated:** the step did not run. Tasks, Bot jobs, review gates and source checks are always
  simulated. Open a step to see the inputs it would receive, such as its exact instructions with the
  trigger data.
- **Not reached:** a real run with this input stops before this step.

**Not tested by this dry run** lists the paths that this input did not test. Examples are a review
rejection, a task failure, a GitHub label filter, the write access check and quiet hours. Change the
sample data or the simulated outcome to test another path. Warnings show current conditions that
make a real run fail or not start, such as a paused Bot or paused triggers.

For a monitored source, the instructions show the sample content. After the first successful run, a
real run also adds a **Previous successful source** block. An automatic run ends as **Unchanged**
without work when the source matches the last successful run and the latest run of the automation
completed. The runtime stores that outcome with the source, so the check still works after the
30-day run history cleanup. After a failed or cancelled run, the next run processes the source
again, even when it has not changed. Manual runs always process the source. The dry run cannot show
that block, so it lists it under **Not tested by this dry run**.

A dry run never fires a trigger, creates a thread, posts to a Bot, sends a notification or reads a
monitored source. The runtime does not store dry runs. They do not appear in Runs, use a schedule
occurrence or webhook delivery, or count toward routine limits. Use **Test run** for real work with
triggers disabled.

Clients call `POST /api/jobs/dry-run` with `{ "flow": …, "input": …, "stopAt": "node-id" }`. The
runtime advertises `automationDryRunSupported`. Clients hide **Dry run** for older runtimes.
`packages/runtime/src/jobs/dry-run.ts` classifies every step kind as pure or external. A new step
kind fails typechecking until someone classifies it. The runtime simulates unknown step kinds.

Agents call `studio_automations` with
`{ "action": "dryRun", "automation": …, "input": …, "stopAt": "node-id" }`. The automation can be an
unsaved draft. To test a saved automation, read it first. Read-only agents can use dry runs. An
older runtime rejects the `dryRun` action.

### Save Dry run scenarios

Run a sample, enter a scenario name and choose **Save as scenario**. Dovo saves the sample input,
simulated outcome, and expected result for each step on the automation's computer. Save different
inputs for cases such as an accepted event, a filtered event or a rejected review.

Choose **Run saved scenarios** after changing the automation. Each case shows whether the outcome or
a step's status changed. Select a case to load its sample, rerun it and choose **Update scenario**
to replace its expectation. Delete a case when it is no longer needed. The limit is 12 cases per
automation, each up to 32,768 characters. Use sample data without credentials or private records.
Scenario runs use the same simulated Dry run path. The runtime advertises
`automationDryRunScenariosSupported`.

## Follow a run

Current work and reviews stay visible even after 100 newer runs. A link from an existing automation
loads the exact retained run by ID, including when it is outside recent history. Older runtimes can
show links from their recent run list. Agents can use `studio_automations` with `action: "readRun"`
and the run ID for its status and steps. The direct lookup omits the trigger payload and saved
definition.

Under **Failed attempts**, choose **Explain attempt** to open a read-only thread draft. It uses the
recorded failure and step from that attempt's saved definition. Review the draft, then send it if
you want a diagnosis. Opening the draft does not retry the automation. Dovo retains up to 20 failed
attempts with the run. Older run records can show the last failure only when it is still available.

Each run records the current step, completed steps, review gates, failures, task links and start/end
times. Expand run details on mobile or open **Runs** beside the desktop canvas. Steps distinguish
queued work from work that is running, awaiting review, completed, failed or cancelled. An approval
applies to the displayed step and attempt. Refresh the run after a stale approval.

When a review response is lost, repeat the same decision for the same step and attempt. The runtime
confirms the saved decision without advancing the current review. An opposite decision for the same
step and attempt returns a conflict. The saved outcome survives a runtime restart.

By default, one run of an automation may be active or waiting for review at a time. Different
automations can run at the same time. Tasks that use the same checkout share its files and
uncommitted changes. Use separate worktrees to isolate changes.

Set **Concurrent runs** under **Monitoring and limits** to admit up to that many runs and queue
additional requests in arrival order. Use `1` to queue without overlap. Queued requests survive
restart, can be cancelled, and wait for review when they reach a review step. A cancelled worker
continues to occupy a slot until its work stops. Lowering the limit lets current runs drain. Clear
the setting to return to the default policy for new requests. Already queued requests finish one at
a time. Finish or cancel queued runs before rolling back to an older runtime.

Give automations the same **Shared run pool** name when their runs share a resource on one computer.
Runs queue together in arrival order. A shared pool uses each run's saved limit, including the limit
of the run waiting at the front. For example, a run with a limit of `1` runs alone in its pool.

Agents configure `policy.concurrencyLimit` and optional `policy.concurrencyPool` through
`studio_automations` on runtimes that advertise `capabilities.automationConcurrency`.
`queuedForAdmission` identifies a waiting run that has yet to execute any steps.

Set **Shared step pool** and **Concurrent steps** on a task step to share capacity on the same
computer. Steps queue in the order they reach the pool. The limit of the first waiting step and the
limits of active steps all apply. A run keeps its run slot while waiting for a step slot. Run pools
and step pools are independent, even when they have the same name.

Queued steps survive restart. A cancelled step holds its slot until the worker stops. Clear the pool
name to remove the limit from future runs. Agents can set `data.stepPool` with a `name` and `limit`
through `studio_automations` and read `waitingForStepPool` on the run.

Use **Pause run** to hold an active run at the next completed step. **Keep running** clears the
request while that step is still working. A run already waiting for review, CI, a pool slot, or a
provider retry pauses immediately. **Resume run** restores that wait or starts the next unfinished
step. Paused steps leave capacity available for other steps. A run that was already admitted keeps
its run slot. The CI timeout, provider retry delay, and run time budget stop counting time during a
manual pause. Progress and the pause survive restart.

**Cancel run** withdraws outstanding questions from the run's worker turns, including forms a worker
left open when it finished. Cancelling a pending review closes the gate without recording a review
decision.

Under the default policy, recurring schedules skip an occurrence while a previous run is active or
waiting for review. The schedule then moves to its next future time. **Activity & message history**
on desktop or the computer’s **Activity** panel on mobile shows **Skipped: previous run still
active**, the automation name and due time. Expand the entry for the automation ID, occurrence key
and previous run ID. These entries follow the seven-day diagnostic retention window, even when
activity history has no limit. Maintenance keeps due occurrences pending. An accepted one-time
reminder can retry a provider startup failure after its schedule has been consumed. Cancel the run
to stop its retry.

## Retry and stop

**Retry** resumes a failed or cancelled run. It preserves completed steps and reuses the unfinished
step's task, conversation and checkout when that task still belongs to the unfinished step. If a
later chat reply replaced the failed result, Retry starts a fresh task for the step. A review that
was rejected must be approved again before execution can continue. Retry waits for cancellation to
finish and refuses to overlap another run of the same automation.

Retry does not roll back files or guarantee that an interrupted tool command had no effect. Inspect
the failed task's output and changes when the error happened during an external action. Retrying
uses the original run configuration; to use edited instructions, start a new run.

**Cancel** stops the current task and prevents later steps from starting. After a runtime restart,
interrupted runs are marked failed with an explicit recovery message. Retry reconciles tasks that
already completed before the run saved its next step, avoiding an unnecessary second execution. It
recovers the worker's saved answer and attachments for any later steps that use them. Waiting review
gates survive restarts. If all steps finished before the final save failed, the runtime records
completion from the saved steps on the next scheduler pass or restart.

## Delivery and scheduling

Manual starts accept an optional `requestId` at `POST /api/jobs/run`. Repeating an accepted request
for the same automation returns its original run ID, including after restart. Clients retain the ID
after a lost response so retrying the request does not create a second run.

Webhooks require a credential and unique `X-Idempotency-Key`. Duplicate deliveries return HTTP 409.
Delivery acceptance and run creation commit together. Retry an existing run with
`POST /api/jobs/retry` and `{ "id": "run-id" }`.

Recurring schedules do not replay downtime. Missed ticks while the runtime is running are coalesced,
and overlapping runs are skipped. Invalid schedules are isolated so they do not stop other
automations.

## Multiple projects in a task step

Task steps can include **Linked projects** on the same computer. Each link selects a main checkout,
an existing worktree, or a new worktree, with reference-only or edit access. New worktrees have
unique branch suffixes per task, so separate automation runs do not reuse each other's checkout.
Tasks can edit the same existing worktree or main checkout at the same time.

The primary project supplies agent defaults and tools. Each linked project's own worktree setup
command runs before execution. Editable Git checkouts have separate checkpoint files and can be
reviewed from the thread's Changes project selector. Reference-only is conveyed through harness
permissions and instructions; it is not an operating-system sandbox.

New step threads use the normal title generator with their submitted instructions. Generation runs
independently of the task; a failure keeps the step name, and a manually edited title is preserved.

## Restore a run definition

Open a retained run and choose **Restore definition from this run**. Edit the JSON draft and read
the comparison. Save restores the automation for future runs and pauses its automatic triggers. It
preserves the automation ID and current connection and credential fields. Running jobs keep their
saved definition. The webhook credential stays unchanged.

A conflicting save keeps the draft. Choose **Compare with current definition** to load the latest
comparison without replacing your text. Cancel discards the restore draft. A draft stays available
when you leave and return in the same app session. Restarting the app clears it. Older runtimes show
an update message.

Agents can use `studio_automations` action `definition` with a retained run ID. It returns a safe
`automation` draft and the `expected` current definition. Action `restore` takes the run `id`,
`expected` and edited `definition`. It checks access and conflicts, records the agent source and
pauses triggers. Read-only agents can inspect a definition but cannot restore it.

Restore keeps the current provider identity for a matching step. If that provider changed since the
run, restore also keeps its current model and reasoning. It does not pass one provider's connection
credentials to another provider. Historical connection and environment fields are removed for steps
that have no matching current step.

Task steps can select connected preceding task results as inputs. File copying requires a separate
Include files choice. Scheduled provider startup retry is off by default and only retries before
confirmed input acceptance. Queue time and work time appear separately in run details. See
[the appended Studio scans](studio-scan-follow-up.md#appended-scans-november-17) for setup, limits,
recovery and verification commands.
