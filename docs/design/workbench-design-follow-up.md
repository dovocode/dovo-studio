# Workbench design follow-up

Keep the dense desktop layout and native mobile navigation. Improve how people find a decision,
verify work, and return to their place. This list is scope, not a record of completed work. The
composer redesign is out of scope.

| Area | Acceptance criteria |
| --- | --- |
| Thread attention and notices | Keep unread separate from pending input. Show the reason and count on parent and pinned rows. Open the exact request on its computer. Keep the pending action near the header. Record the decision in the timeline and verify it after an interrupted submission. Dismissing a notice does not dismiss the request. |
| Thread info and layout | Lead with the project, checkout, and computer. Keep agent and connection state distinct. Link to pending requests, checks, changes, and related work. Preserve section preferences, drafts, and reading position across narrow layouts and mobile sheets. Keep essential actions and keyboard focus visible with large text and high contrast. |
| Timeline and verification | Summarize tool groups by work and failure. Show the active step. Separate decisions, agent claims, recorded test results, and CI evidence. Identify each check's commit and attempt. Open the failed step when known. Name what refresh and retry do. Include the revision and remaining work in linked handoff summaries. |
| PR overview and viewer | Give each attention row a reason. Keep manual review, agent review, and one-run configuration distinct. Resume saved drafts and show the running review rather than start another. Preserve the file, line, and list position on return. Keep reviews pinned to a revision until the user switches. Retain unchanged viewed marks and flag draft comments that need a new line. Keep publication human-reviewed and show the account, decision, and revision. |
| File review and checkpoints | Separate changed-since-review from unread files. Count collapsed or non-text changes. Distinguish a turn snapshot from the cumulative checkout diff. Preview affected checkouts and protect newer local edits before undo. State that file undo does not rewind the conversation. |
| Browser and terminal | Show the owning computer, profile or sandbox, and session type. Explain separate workspace and preview logins and remote localhost. Keep linked-thread navigation separate from sending selected page content. Distinguish reconnect, a stopped process, and ending a session. Preserve position and focus across view changes. |
| Search and history | Make mobile Search discoverable. Show matching message context, project, and computer. Preserve results and reading position on return. Provide reply links and bookmarks without granting access. Label archived results without restoring them. Keep reading position stable while new replies arrive. |
| Setup, scope, and availability | Give first-use screens one clear next action and keep General available. Distinguish empty, filtered, partial, offline, and unsupported states. Name the computer or account that could not be checked. Show effective setting values, their source, and managed restrictions. Explain pending pairing without discarding an existing connection. Show scope in pickers and command results. |
| Automations, Bots, and limits | Show enabled state, next run, and last result. Open the affected run for recovery. Distinguish Pause, Stop, and Resume and name the work each affects. Show monitor activity, memory review, and skill proposal scope. Separate provider allowance, estimated cost, and unattended spend limits. Explain stale readings, unknown prices, and what resuming starts. |
| Moves and forks | Show ownership and recoverable state during a move. Give computer-specific open and recovery actions. Preview which conversation and files a fork will use. Link source and fork to the starting reply. Keep returning a conclusion separate from moving code. |
| Artifacts and embedded views | Show local and hosted versions separately from access. Identify the source and revision of agent-provided data. Distinguish editing, sending, and external changes. Preserve compatible drafts and explain revision conflicts. Offer a saved result when an interactive view is unavailable without rerunning its tool. |
| Destructive and private actions | Preview what project deletion removes, changes, and keeps. Link blockers. Show scope and partial results for bulk actions. Offer Undo for supported routine changes. Show diagnostic contents and make optional logs deliberate. Show secure input destination and status without saving the secret for retry. |

Verify the common paths on desktop/web and mobile. Include narrow windows and large text. Test
disconnects while reading and while actions are in flight. Keep HTTP LAN/VPN support, pairing codes,
and device tokens. Never treat a saved result or pending form as permission to act.

Agent review settings apply to the next run on updated runtimes. The run record keeps those settings.
Older runtimes still update the saved defaults when a run starts. The review settings show this limit.

PR rows that match the Needs attention filter show the reason in the row on desktop, web, and mobile.

Collapsed mobile tool groups show the active tool while the turn runs. Completed or interrupted
turns show the group summary instead.

An open mobile PR line draft keeps its text when a push changes the revision. Posting stays disabled
until the user switches revision and selects a line for a new draft.

Reasoning summaries and other reasoning text that a harness exposes for display remain readable
with full tool details off. Raw provider fields are not shown.
