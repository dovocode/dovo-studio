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

## Linked projects and worktrees

In thread settings, **Linked projects** attaches up to twelve registered projects or checkouts on
the thread's computer. Choose main checkout, an existing worktree, or a new worktree with optional
base branch and branch name. New branch names receive a unique suffix. Links can be changed while
the thread is idle; changing links starts a fresh provider session. Removing a link preserves its
worktree and saved checkpoints.

The primary checkout remains responsible for thread settings and its PR status. Linked checkouts are
available in Changes and when opening a terminal. Agents receive their paths, project names and
access modes, and can create separate commits and PRs in each project. A child agent can target a
link by its checkout ID; reference-only links cap child permissions at read-only.

Each editable Git checkout gets independent checkpoint previews. Undo and redo restore all recorded
checkouts together, with backup snapshots for recovery. Checkpoint history remains available after a
link is removed. Worktree cleanup protects links used by unarchived threads, and refuses to remove
dirty worktrees.

### Pull request workspace

Desktop and web show a full-width PR list until a PR opens, then keep a compact list alongside its
details. Search, repository, state and sort controls stay visible, with refresh, creation and
connection actions in the header. Draft and attention filters live under **Filters**. Personal views
use each computer's authenticated forge account. **Involves me** includes authorship, assignment and
review participation reported by the forge. GitHub also includes conversation participants. Gitea
and Forgejo include requested reviewers and assignees. Bitbucket includes reviewers and
participants; Azure DevOps includes reviewers. Bitbucket and Azure DevOps have no separate PR
assignee field, so **Assigned to me** applies to GitHub, Gitea and Forgejo. Filters apply to loaded
pages; load more to expand results. Missing identity or relationship data is reported rather than
treated as a match.

**Overview** combines the description, discussion and a Markdown comment composer, with review
decisions, reviewers, assignees and labels alongside them on wide layouts. The title, branches and
review/check summaries remain visible across sections. **Checks** shows check output, annotations
and pipeline runs for the PR head commit. **Changes** shows stacked file cards, a searchable
directory tree and local reviewed-file progress. Selecting a tree entry scrolls to its card. Review
decisions remain tied to the commit captured when the review form opens. Review/comment editors
provide formatting insertion and a rendered preview; submissions still use Markdown and the existing
forge capability and revision checks.

## Copying local files into new worktrees

Add a `.worktreeinclude` file at the registered project's checkout root to copy local files into new
worktrees before their setup command runs. This also applies to linked projects, PR worktrees, and
recreated checkouts. Existing worktrees are left alone.

Use one project-relative file, directory or glob pattern per line. Directories copy recursively;
globs such as `.env*` and `apps/**/.env.local` include matching local files even when Git ignores
them. Blank lines and lines beginning with `#` are ignored. For example:

```text
# Local development configuration
.env.local
apps/**/.env.local
local-config/
```

Missing matches are skipped. Files already present in the new checkout are preserved, so includes
never replace committed branch content. Only regular files are copied; symbolic links are not
copied. Paths outside the project and explicit `.git` entries are rejected; broad globs skip Git
metadata. The manifest can be committed or kept local to the registered project.

## Orphaned worktrees and thread deletion

In **Settings → Coding → Worktrees**, enable **Show orphaned only** to list Dovo-created checkouts
with no remaining thread reference. This includes dirty checkouts; only clean worktrees can be
removed. Other worktrees in registered projects are excluded.

**Remove worktrees when deleting their last thread** defaults off and saves on the selected
computer. The desktop thread deletion dialog uses this setting as its default and lets you change it
for that deletion. Bulk deletion and deletion from mobile use the computer's setting. Archived
threads, existing-worktree selections, linked projects and saved linked checkpoints all count as
references. Cleanup keeps branches and never forces removal of uncommitted changes. Ignored local
files, including `.worktreeinclude` copies, are deleted with removed checkouts. Dovo remembers
managed checkout locations after the worktree folder changes or threads are deleted.
