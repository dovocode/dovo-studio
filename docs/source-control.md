# Source control

Source control connections, linked checkouts, worktrees, pull requests and commit review all run on
the computer that hosts the project. Open **Settings → Source control** on that computer to add a
connection, then link it in the project's source-control settings. Set up a provider with its guide:

- [GitHub](github-integration.md): GitHub CLI login, accounts and API behavior.
- [Forgejo and Gitea](forgejo-gitea.md): instance URL, token scopes and project binding.
- [Bitbucket Cloud and Azure DevOps Services](bitbucket-azure.md): connection setup and
  capabilities.
- [Issues, pipelines and Jira](issues-pipelines-jira.md): connected issue and pipeline sources.

Automation triggers, steps, runs and linked projects in task steps are in
[Automations](automations.md).

## Linked projects and worktrees

Scope mode is experimental and off by default. Enable **Scope mode (experimental)** in Settings →
Running tasks on the selected computer.

Before the first message, choose **Scope** (the magic icon) in the project picker to infer the
primary project and necessary linked projects from your prompt. Machine selection remains explicit:
Scope uses only registered projects on the selected computer. It reads bounded documentation,
workspace manifests and source paths up to four levels deep, prioritizing components mentioned in
the request. Package names and dependency relationships help distinguish implementation owners from
consumers. Discovery visits at most 64 directories per project and flags partial evidence; it skips
dependency/build folders and symbolic links. The selector then searches relevant source, callers and
contracts to identify the intended change and project ownership. Choose **Project defaults**, **New
worktrees**, or **Local checkouts** alongside Scope; the checkout choice applies to the primary and
linked Git projects, while folder projects always stay local. Choose a project manually to select an
existing worktree or a specific base branch. It uses the selector utility model in Settings → Agents
(inheriting the title model by default) and runs an ephemeral read-only investigation (up to two
minutes). It cannot edit files or create checkouts, and tool approval requests are denied.
Unavailable folders are marked as uninspected; uncertain matches remain available for manual
selection. Clear matches start with the selected project's defaults; reference links are read-only
and projects requiring changes receive edit access. If no project is discovered, Scope continues in
General without linked checkouts. Invalid selections or model failures keep the prompt unsent so you
can choose a project manually or retry. General conversations stay in the private thread folder.

In thread settings, **Linked projects** attaches up to twelve registered projects or checkouts on
the thread's computer. Choose main checkout, an existing worktree, or a new worktree with optional
base branch and branch name. New branch names receive a unique suffix. Links can be changed while
the thread is idle; changing links starts a fresh provider session. Removing a link preserves its
worktree and saved checkpoints.

Agents also have a regular `dovo_task linked_projects` tool, independent of Studio Tools settings:

- `projects` lists registered projects on the thread's computer.
- `worktrees` with `repositoryId` lists existing worktrees.
- `list` returns active links and any pending configuration.
- `add` accepts a `checkout` with a stable `id`, `repositoryId`, `execution` (`main` or `worktree`)
  and `access` (`read-only` or `edit`). New worktrees may specify `branch` and `baseBranch`;
  existing ones use `existingWorktreePath`.

This works for General threads too. Additions made during a turn are saved for the next fresh turn;
the current agent's folders, permissions and checkpoints stay unchanged. A follow-up message starts
with the links and a fresh provider session. Interrupted-turn recovery keeps its original roots;
pending links wait for a fresh turn. Repeating the same ID/configuration is safe, while reusing an
ID for different settings fails. Read-only agents can inspect links but cannot add them. Child
agents inherit their parent's configuration. The tool acts only on its own thread and computer. The
linked projects editor displays pending links and lets you adjust them once the thread is idle.

The primary checkout remains responsible for thread settings and its PR status. Linked checkouts are
available in Changes and when opening a terminal. Agents receive their paths, project names and
access modes, and can create separate commits and PRs in each project. A child agent can target a
link by its checkout ID; reference-only links cap child permissions at read-only.

Each editable Git checkout has its own checkpoint previews. In a turn diff, select a file to restore
its contents from before the turn. Checkpoints cover the full Git worktree even when an imported
session starts in a subfolder. Studio can restore a symlink without following its target. If the
selected file exists on disk but is missing from the Git backup, move it to a safe location before
restoring. If a directory replaced that file, Studio keeps the directory and stops the restore.
Concurrent edits can appear in the same diff. Studio blocks file restoration for checkpoints that
overlap another running thread. To continue work from an earlier turn in a separate checkout, fork
that turn. Checkpoint history remains available after removal of a linked project. Worktree cleanup
protects links used by unarchived threads and dirty worktrees.

#### Recover files saved by an earlier Undo

Older runtimes saved a Git tree in each affected repository before applying Undo. For a thread with
a saved backup, select **Review saved Undo backup**, then **Keep current files**. Studio adds the
tree IDs to the conversation and releases any interrupted Undo. This action leaves the checkout and
Git index intact. Use the tree ID for the matching project. List its files, read a file, or save a
copy to a new location with these commands. Replace `TREE` and the example paths first.

```sh
git ls-tree -r --name-only TREE
git show TREE:path/to/file
git show TREE:path/to/file > /path/to/new-copy
```

For an older client, update Studio to review backups. Update the paired runtime to use **Try again**
with the current files.

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
directory tree and local reviewed-file progress. Selecting a tree entry scrolls to its card. Studio
restores the selected file and scroll position when you reopen the PR in the same session. Review
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

Creating worktrees requires Git 2.36 or newer for NUL-delimited registration reads. Creation uses a
unique Git lock while checkout hooks and local-file copying finish. Stop cancels the owned Git
process tree, including fetch and submodule preparation; a checkout whose process shutdown is
unconfirmed remains unavailable until exit is confirmed. A confirmed failed attempt removes only the
folder and registration it still owns. An unknown replacement folder or registration is preserved
and reported for recovery.

Retries never prune missing worktree registrations automatically: those registrations can contain
staged files even when the working folder is gone. Restore the folder, or inspect and explicitly
remove that specific registration before retrying. Worktrees still locked by an incomplete creation
attempt are not adopted as ready checkouts. Creation unlocks before setup, which takes its own
attempt-specific `dovo-preparing` lock through snapshot restoration, submodules, setup and saved
completion state. Ordinary failures unlock after their commands drain and can be retried without
recreating the worktree. Unconfirmed commands retain the lock until exit is confirmed. A hard
runtime kill leaves the lock in Git; new runtimes refuse the checkout. Confirm its setup commands
have stopped before explicitly unlocking the registration. A stale runtime PID alone does not prove
its detached commands have exited. A launcher exiting while descendants retain its output pipes
produces a bounded shutdown error and keeps ownership until the pipes actually close. Windows setup
commands that deliberately leave background processes with redirected output are not covered by the
POSIX hard-kill verification.

New task branches created from an origin base use `--no-track`, so their first push creates the task
branch instead of advancing that base. Existing branch tracking and explicitly configured upstream
destinations are preserved. Check the upstream of task branches created by older versions before
pushing; changing it requires an explicit Git configuration change.

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

## Experimental model selection

When Scope mode is enabled on a computer, new threads and quick launchers start in Scope if no
specific project is selected. Explicit project choices, including General, override that default. If
Scope discovers no project, the thread continues in General with no linked checkouts and a saved
notice explaining the fallback in the desktop and mobile conversation. Existing threads keep their
selection.

Inherit is always available. Enable **Tune & Maestro modes (experimental)** in the computer's
Running tasks settings to enable Tune and Maestro. Before the first message, the model picker
offers:

- **Inherit**: use the primary project's exact harness/model defaults, falling back to system
  defaults.
- **Tune**: keep that default harness and choose an available model for the prompt's difficulty.
- **Maestro**: choose an available harness and model, preferring project/system defaults where
  suitable.

The runtime resolves the choice once and saves the concrete harness/model for the thread. With Scope
project selection, projects resolve first. Hidden or disabled models are excluded.

Tune and Maestro have a separate **Difficulty** picker, starting at **Auto**. An explicit difficulty
guides model choice while the selector independently chooses a supported reasoning level for that
model. The model and reasoning are fixed together before the first turn. Inherit and specific models
keep their usual reasoning settings. If selection fails, the message stays queued and the startup
card shows the error. **Retry** runs the failed step and keeps later prompts paused. Only Maestro
can be saved as an automatic project or system task default. **Scope model mode** is a separate
computer preference with Inherit, Tune and Maestro; it starts at Inherit and does not follow the
ordinary task default mode. Choosing Scope mode uses that preference, while preserving an explicitly
selected Tune or Maestro model mode.

Titles and dictation require an explicit utility harness and model in Agents settings. The **Scope,
Tune & Maestro selector** inherits that title model by default. Set a separate utility harness/model
there to use a different model for project selection and coding-model selection. Selection runs
without tools and can choose only entries from the computer's discovered catalogs.

Desktop **Pull requests & pipelines** settings combines device-local draft/merge defaults with
lifecycle and monitoring preferences on the selected computer. Device defaults remain editable when
the computer is offline. Mobile Source control shows automatic and saved GitHub identities, projects
using them, and explicit repository/Actions access tests. Account checks run on opening; project
access checks run only when requested.

General drafts expose **Link projects** directly in their setup on desktop and mobile. Links stay
part of the draft and are included when the thread is created on its chosen computer. Expanded
Settled sections show five threads with Show all/Show fewer controls; search and bulk selection
include the full history.

The **Linked projects tool** switch in the computer’s Running tasks settings controls agent access
on desktop and mobile. It is enabled by default. Disabling it blocks new calls immediately and omits
the tool and its guidance on the next turn. It preserves existing/pending links and manual linking.
A new provider session is created when the setting changes between turns.

## Review local commits

Open a thread's changes and choose **Local commits** on desktop/web or mobile. The picker pages the
selected checkout's first-parent history, including linked checkouts. Choose a commit to review its
saved changes without checking out a branch, preparing a worktree, changing the index or discarding
working files. Viewed-file progress is isolated by thread, checkout and full commit SHA.

Each commit is compared with its first parent; a merge uses its first parent and a root commit shows
its initial files. A shallow boundary with an unavailable parent reports **Fetch more history**
instead of presenting all files as additions. Only commits reachable from the selected checkout's
HEAD can be reviewed. Draft threads show project history before their worktree is created. Renames
currently appear as a deletion and addition. Large/binary previews stay tied to the selected
immutable commit, and the full-file action uses that same commit.

Commit review is read-only. Switch back to working changes to edit, discard or attach working-diff
comments. File grouping and viewed marks remain available for the chosen commit.

## GitHub access failures

GitHub API failures with HTTP 401, 403 or 404 identify the captured host, repository and verified
account when available, together with the credential source used for that request. Guidance points
to the saved token, runtime environment, GitHub CLI login or configured CLI wrapper that needs
attention. Use the connection check in **Settings → Source Control** to verify access after repair.
An account switch while a request is running does not relabel its original credential. Error text
does not include token values or upstream error bodies. A 404 means missing or inaccessible; it does
not establish that a private repository was deleted. Rate-limit failures retain their existing quota
and retry behavior.
