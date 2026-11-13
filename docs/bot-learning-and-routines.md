# Bot learning and routines

## Memory review

Configure a utility harness and model in **Settings → Agents**. Open a Bot’s **Memory** section.
Background learning starts enabled. Dovo reviews new owner messages after 20 completed turns, or
after 15 idle minutes with at least 3 new turns. It runs at most one review at a time and yields to
new conversation work. A paused Bot, a paused queue, and read-only access block reviews.

Each review uses a separate utility session with tools disabled. It receives at most 40 eligible
messages and 32,000 characters. It excludes assistant text, worker output, automation input,
commands, incomplete turns, and text that matches known secret patterns. These filters cannot detect
every sensitive fact. Do not put secrets in saved notes.

Learned notes show source quotes. Select **View source message** to open the message. The runtime
checks that each quote occurs in a direct owner message. This check does not prove that the model’s
conclusion is correct. Edit or delete incorrect notes. Your edits remove the learned marker and
protect the note from later automatic changes. Deleted keys stay forgotten.

Use **Pause learning** to stop automatic review. Use **Review now** to review the pending batch. Use
**Clear memory** to remove all saved notes. Clear also advances the review cursor, so earlier
messages do not restore the notes. Failed reviews preserve the notes and cursor. They retry after
one hour, or when you select Review now. Settings and cursors survive runtime restarts.

Context reset, compaction, and memory are separate. Reset changes future model context and keeps the
saved transcript, notes, files, and completed actions. Supported Claude, Codex, and OpenCode
sessions can compact before a new prompt at 80% reported context usage. Dovo requires a provider
acknowledgement. It limits automatic attempts to two while the same session remains full. Native
worker activity blocks this automatic step. Other harnesses retain their own context behavior.

## Isolated jobs and the work inbox

In Automations, add a task node and set `data.botId` to an existing Bot on that computer. The node’s
objective runs in a new worker thread. It uses the Bot’s saved harness, model, permissions, MCP
servers, skills, role, and a bounded copy of saved notes. It has no project or linked-checkout
inheritance. The main conversation stays available. This snapshot of notes does not grant the worker
direct access to private Bot memory tools.

The **Routines** section starts with a **Work inbox**. It links to workers and routine runs.
Failures and review requests appear first. Open an item to inspect the transcript, approve work, or
stop it. A terminal run adds one result to the Bot per attempt. Stopping a routine stops its owned
worker family. It does not stop the person’s Bot conversation. Pausing a Bot blocks new workers;
existing work may finish. Narrowing access stops workers that exceed the new limit. Older jobs
already queued in the Bot keep their original delivery identity during recovery.

Recurring schedules save their next due time. After downtime, Dovo catches up once and moves to the
next future time. It does not replay every missed occurrence. An active run causes an overlap to be
skipped. A transient acceptance failure keeps the unconsumed due time for recovery. One-time
reminders wait while another run is active. Runtime shutdown preserves run history. Retry resumes
unfinished work. It does not reverse completed file changes or actions.

## Monitoring, limits, and testing

Open an automation’s **Triggers** view on desktop, or edit it on mobile. Set **Monitoring and
limits**, then save. Leave optional fields empty to disable them.

- **Monitor source URL** performs an unauthenticated HTTP or HTTPS GET before the model starts. LAN
  and VPN addresses stay supported. The check uses no browser cookies or saved credentials. It
  permits at most three redirects and 512 KiB of response data, with a 15-second timeout. It
  compares exact response bytes. Dynamic page noise can therefore count as a change.
- The first successful observation runs the agent. Later automatic runs with identical content
  finish as **No change** without invoking the agent. A failed run forces the next observation
  through the agent. Only a completed run updates the baseline. Manual runs always invoke the agent
  after a successful source check.
- **Time**, **token**, and **estimated cost** limits apply to the run and its local child workers.
  The time limit includes approval waits and retries. Usage limits use reported turn totals. The
  runtime samples limits each second and after a provider turn. Late or missing usage can cause
  overruns. Cost is an API estimate, not a subscription bill or a hard spending guarantee.
- **Quiet hours** use the saved time zone and can cross midnight. They defer successful Bot reports
  until the interval ends. Failed runs and approval requests remain visible. Successful worker push
  notifications are suppressed during quiet hours. Run history remains available.

With triggers disabled, use **Test run**. It performs real work with the saved tools and access.
Inspect its result before enabling the schedule. A test does not enable triggers or move the next
scheduled time. A lost acknowledgement retains the same manual-start request ID.

## Reviewed skill proposals

After a completed method proves useful, the coordinator can call `propose_skill` with a stable key,
`sourceTaskId`, `sourceTurnId`, `name`, `description`, and `content`. The source must be a completed
turn in that Bot or an owned worker. Preparation installs nothing.

Open **Skills → Proposed skills → Review skill diff**. Inspect the content and description. Select
**Apply skill** or **Reject proposal**. Apply affects only this Bot’s future turns. The runtime
rejects a stale review or a changed original skill. Repeating an accepted request does not install a
second copy. Proposal receipts survive restart. At most ten proposals are kept in the Bot view; new
proposals can replace old terminal entries, while their receipts remain until Bot deletion.

## Verification

Run from the checkout root:

```sh
pnpm --filter @dovo/protocol build
pnpm --filter @dovo/runtime build
pnpm exec vp test packages/runtime/src/http/endpoints/bot-memory-review.test.ts packages/runtime/src/http/endpoints/bot-routines.test.ts packages/runtime/src/http/endpoints/bot-context.test.ts packages/runtime/src/http/endpoints/bot-skill-proposals.test.ts packages/runtime/src/jobs/source-monitor.test.ts packages/protocol/src/automation/routine-policy.test.ts
pnpm exec playwright install chromium
pnpm test:bots:browser
pnpm build
pnpm typecheck
pnpm check
```

Runtime checks use real HTTP, SQLite, MCP, and local source servers with scripted model adapters.
Browser checks mount the web and mobile React components with fixture transport and native controls.
These checks do not verify live provider compaction, model quality, provider billing, or native
phone interaction.
