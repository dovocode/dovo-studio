# History search and worktree cleanup

Task search queries each connected computer. Results appear as each computer responds. The loading
state stays visible until all requests finish. A failed computer does not remove results from other
computers. A new query, computer scope or pairing credential cancels the old reads and rejects their
responses. Offline computers still supply saved thread details to the normal thread filter.

On mobile, search also shows message excerpts above the thread list. Each result identifies its
computer and thread. Tap a result to open that message. Child threads keep their own identity. The
conversation loads older pages through the same path as bookmarked replies. Loading, missing
messages, failed page reads and offline computers have explicit feedback. Normal thread rows keep
their existing navigation and filtering.

Worktree cleanup checks ordinary Git status and tracked content hidden by `assume-unchanged` or
`skip-worktree`. It does not clear index flags or change Git settings. It uses Git clean filters and
line-ending rules when it compares regular files. It compares symlink targets without following the
link. Missing sparse-checkout files remain valid. A clean flagged file does not block cleanup.
Initialized submodules receive the same content check.

Cleanup refuses files that it cannot inspect. Limits are 100,000 index entries, 10,000 inspected
hidden files or submodules, 64 MiB per hidden file, and the existing Git read limits of 2 MiB output
and five seconds per read. Invalid UTF-8 paths and failed file reads also block removal. The
worktree list marks an uncertain inspection as changed. Cleanup checks content again before its
final owner and shell checks. Git removal still uses no force, and branches remain on disk. Existing
ignored-file policy stays the same.

Run the focused checks from the repository root:

```sh
pnpm exec vp test packages/runtime/src/scm/git/worktree-changes.test.ts packages/runtime/src/scm/git/worktrees.test.ts packages/runtime/src/jobs/jobs.test.ts packages/studio-shell/src/task-notifications.test.ts --maxWorkers=1
pnpm --filter @dovo/runtime typecheck
pnpm --filter @dovo/extension-tasks typecheck
pnpm --filter @dovo/studio-shell typecheck
pnpm --filter @dovo/mobile exec tsc -p tsconfig.json --noEmit
pnpm exec playwright install chromium
pnpm test:task-search:browser
```

The Git tests use real disposable repositories and worktrees. The browser checks run production
search hooks and mobile conversation restoration in managed Chromium. Mobile checks mock React
Native controls and transport. They do not establish native list measurements or physical-device
behavior. No iOS or Android device run is included in these checks.

Recurring automation skips appear in the existing activity log. See [Automations](automations.md)
for the scheduling and retention policy. Cancelled tasks do not send a success notification.
