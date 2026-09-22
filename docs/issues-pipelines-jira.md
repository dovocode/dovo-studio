# Issues, pipelines and Jira

Open **Issues** on desktop/web or the native **Issues** tab on mobile. Browse code-host issues and
independent Jira sources across all saved computers. A Jira source does not require a Dovo project
or a cloned repository. Opening an item selects its host and uses that computer’s accounts.
Pipelines are part of **PRs → select a PR → Checks**, with runs scoped to the PR’s exact head
commit. They no longer have a main-menu item or a project shortcut. Existing run links from
investigation tasks still open their details.

## From source to task

Open an issue and choose **Start task from issue**, or open a run and choose **Investigate run**.
For an independent Jira issue, Dovo uses its optional linked project or asks you to choose the
project that will run the task. Reading and managing the issue never requires a destination project.
Dovo opens a task draft containing the description/discussion or run/job context. Choose your model,
permissions and local checkout/worktree in chat, edit the prompt, then send it to start. Creating
the draft does not run an agent, post to the provider or change the issue's status.

The task stays linked to its execution project and source. Jira source links retain their identity
independently of the task's checkout. Use its **Issue**/**Run** button to return to the source, and
the source's **Linked tasks** section to reopen existing work. Retrying a lost creation response
reuses the same task request. Dovo checks the source again before creating the draft and rejects
stale details or a changed source.

Pipeline drafts include the run's branch, commit and available job/step context with links to logs.
The commit is context, not an automatic checkout: the task runs in the checkout selected in chat.
Full logs remain on the provider. Drafts explicitly identify truncated context or partially loaded
discussions/jobs.

In a PR's **Checks** tab, desktop shows matching **Pipeline runs** inline; mobile opens a native
runs screen. Opening a run retains the PR context so Back returns to the same PR. Matching uses the
exact commit, never a branch-name or text match. Use **Check older runs** / **Load more** when more
run pages are available. When creating a PR, **From task** can prefill a linked task's branch,
source title and URL. Review these editable fields and push the branch before submitting; the source
is referenced without automatically closing it.

Issue and run lists expose people, labels, branches, commits and update times when available. Issue
text search queries supported providers, including Jira issue keys, beyond the initially loaded
page. State filters and sorting apply to loaded results. Older runtimes without server-side search
keep local filtering. Search-specific cached pages are kept separate. Refresh keeps loaded content
visible and prevents writes until it is current. On mobile, the Issues tab preserves its selected
source, detail and filters independently. Pipeline screens are reached from PR checks and retain
their originating PR on Back. Opening another computer does not reset collection filters. Details
remain scoped to their owning computer and issue source.

## Choosing project folders

Open **Projects → Add project** and use **Browse** beside the checkout or clone-parent path. On
mobile, open **Projects** from Tasks and choose **Add repository**. The browser lists folders on the
selected runtime computer, including when that computer is remote.

Edit the path to update the folder list automatically, or navigate using folder rows, breadcrumbs,
Home and Up. Filtering searches the current folder's immediate subfolders, including those beyond
the first page; hidden folders are optional. Desktop supports arrow keys, Enter to open, Backspace
to go up, and Command/Control+Enter to choose the current folder. Selecting a folder fills the form;
adding or cloning the project is a separate submission. For cloning, choose the parent folder that
should contain the new checkout.

The runtime resolves symlinks and returns the actual folder path. Legal spaces in folder names are
preserved. Unavailable folders show an error and retry action; an old listing cannot be selected
while a new path is loading or after disconnecting.

## Signed-in CLI accounts

Configure executable paths in runtime settings and choose **Signed-in CLI account** when adding a
source control connection. Authenticate the CLI on the runtime machine first. Dovo does not launch
an interactive sign-in from your phone or silently switch profiles after a failure.

Use the connection's profile picker to load accounts from the runtime host. Dovo lists named `bb`
profiles, named `tea` logins, `fj` server accounts, Azure tenants, and stored `gh` accounts for the
selected server. Project operations and account checks run inside that project's checkout, including
its local CLI configuration. Cloning uses the selected parent directory. Account setup without a
registered project uses the runtime user's home directory.

Selecting a profile does not change the CLI's global default account or subscription. GitHub uses
`gh auth token --hostname HOST --user LOGIN` privately and passes that account only to the
operation's process. Environment-only GitHub accounts remain available through the current-account
option rather than the named-account list. Azure selects a tenant of the current `az login`
identity; `fj` stores one account per server. Use named `tea` logins for multiple accounts on one
Gitea/Forgejo server.

| Provider              | CLI account                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GitHub / Enterprise   | `gh auth login --hostname HOST`; existing projects still work without adding a connection                                   |
| Bitbucket Cloud       | [`gildas/bitbucket-cli`](https://github.com/gildas/bitbucket-cli), executable `bb`; enter the exact configured profile name |
| Forgejo / Gitea       | `fj` account for the server, or a named `tea` login matching its full URL                                                   |
| Azure DevOps Services | `az login`; optionally pin the Microsoft Entra tenant                                                                       |
| Jira Cloud            | `acli jira auth login`; the active account must match the Jira source's site                                                |

Bitbucket uses `bb profile get --show-secrets --output json -- NAME` privately on the runtime, then
uses that profile's access token or user/password for the Bitbucket API. It does not copy these
credentials into workspace snapshots, client caches or command history. OAuth-only profiles without
an exported access token are not supported. Use the CLI's API-token/access-token profile support.
For Git over HTTPS, API-token profiles use Bitbucket's `x-bitbucket-api-token-auth` username; access
token profiles use `x-token-auth`. REST API-token requests continue to use the Atlassian account
email.

`fj` refreshes its login with `whoami`, then supplies the host credential from its own credential
store. Use `tea` for servers hosted beneath a URL path. A current `tea` version with
`tea login helper get --login NAME` is required: Dovo checks the named login's full server URL,
privately reads its refreshed credential, verifies the returned host/protocol, and makes API
requests through its own transport. Credentials stay within the configured origin/base path;
redirected writes are rejected. Configure Git's own SSH keys or credential helper for `fj`/`tea`
clones, fetches and pushes.

Azure CLI support currently uses the Microsoft Entra session from `az login`, not a PAT stored only
by `az devops login`. Existing runtime PAT connections remain available for that case. Account
permissions must include the operations you use: repositories/PRs, work items and/or builds.

## Issues

GitHub, Gitea and Forgejo support listing, reading, creating, editing and commenting. GitHub also
supports editing label names. Gitea/Forgejo label-ID management stays on the server. PR records are
excluded from issue lists. Azure uses project work items, including discovered work item types,
assignees, tags, descriptions and comments; these are project-wide, not limited to one repository.

Descriptions and comments render as Markdown. Existing Azure HTML descriptions are previewed as
Markdown, but their original HTML remains available in the edit form. New Azure descriptions use
Markdown. Writes compare the captured issue revision first; Azure also sends an atomic `/rev` test.
Other providers can still change between the preflight read and mutation.

## Independent Jira sources

Choose **Sources** in Issues to connect or manage Jira. Dovo discovers the signed-in `acli`
account’s Jira Cloud site and projects. Pick a Jira project and choose **Connect Jira**. No Dovo
project, code host or local checkout is required. Manual site/key entry remains available. Sign-in
or discovery errors offer a retry action; source failures remain visible in the issue list.

Each source belongs to the computer whose CLI account accesses it. The runtime verifies the
signed-in site and project, accepting Atlassian’s OAuth gateway URLs in API metadata while rejecting
a different active site. Sources are available beside native GitHub, Gitea, Forgejo and Azure issue
trackers; connecting Jira does not replace a repository's native issues or pipelines.

Open a Jira issue to optionally choose a **Dovo project**. Select **Not linked** to remove that
association. These links live in Dovo and never modify Jira, its project, or the issue. Linked tasks
can belong to different execution projects and remain visible from the original issue.

**Start task from issue** uses the linked Dovo project when one is present. Otherwise it asks for a
destination project on the source's computer. Creating the draft saves that project link in Dovo for
future tasks; it can be changed or removed from the issue. The project supplies the checkout, while
the issue continues to belong to the standalone Jira source. You can create, edit, comment on and
transition issues without linking a project or running an agent.

Jira supports issue lists/details, creation, editing, assignments, labels, comments and a separate
**Change status** action. Enter a target status available in the Jira workflow; Jira enforces the
transition rules. An unchanged description preserves its original Atlassian Document Format (ADF),
including rich elements that Markdown cannot represent. Edits send only changed fields, retaining
unchanged assignments and descriptions. Unsupported rich content falls back to readable text with a
notice and a link to Jira, rather than making the entire issue unavailable. Edited text and new
comments are converted from Markdown to ADF. Temporary body files are private and deleted after the
command finishes.

Jira lists follow the server’s most-recently-updated order. The CLI does not expose update dates in
search results, so those rows omit the date; detail reads provide the real revision before any
write. Open/closed queries use Jira status categories, and exact workflow status names remain
supported. Pagination reads a bounded prefix because `acli` has no offset token; actively changing
results can move between pages. Search can narrow the result set.

Jira Cloud is supported; Jira Data Center is not. Subtask creation requiring a parent and custom
required fields are handled on Jira. If the CLI's detail response contains only part of a
discussion, Dovo shows a notice and links to the full discussion on Jira. Dovo uses the active
`acli` account; switch sites on the host rather than changing accounts while operations are in
progress. Standalone Jira commands use the runtime's account context, independently of a task's
checkout. Jira commands run in the runtime user's home directory. Existing repository-level Jira
bindings migrate to independent sources, preserving historical task links and restoring native
repository issues. Jira profile switching is not exposed: the supported `acli` commands do not
provide a per-command account selector, and Dovo does not change its global active account.

Bitbucket Cloud's retired native issue API is not used. Connect an independent Jira source to work
with Jira issues alongside Bitbucket or any other code host.

## Pipelines

| Provider              | Available actions                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| GitHub Actions        | Dispatch, rerun, cancel, enable/disable workflows                                                    |
| Gitea 1.27+           | Dispatch, rerun, enable/disable workflows; cancellation stays on the server                          |
| Forgejo 16+           | Dispatch, rerun, cancel; enter the workflow filename for dispatch                                    |
| Bitbucket Cloud       | Run a custom/default branch pipeline, cancel; use Bitbucket to rerun with original secured variables |
| Azure DevOps Services | Run build definitions, retry existing builds, cancel                                                 |

Run details show status, branch/ref, commit and provider metadata when available: run number,
attempt, trigger, workflow, commit message, start/completion times and duration. Job details add
runner information, timing, ordered steps and provider-reported errors. Fields that a provider does
not return are omitted; a missing completion timestamp is not treated as a zero-duration run. Active
durations show elapsed time so far.

| Provider        | Run metadata                                                             | Job and step details                                                                              |
| --------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| GitHub Actions  | Run number, attempt, event, workflow name, commit message and start time | Runner, job/step status and timing                                                                |
| Gitea           | Run number, attempt, event, workflow filename and start/completion times | Runner, job/step status and timing; error text is not returned by this API                        |
| Forgejo         | Run number, event, workflow and start/stop times                         | Job status and log links; the public job API does not expose runner, timing or steps              |
| Azure DevOps    | Build number, definition, reason and start/finish times                  | Timeline jobs and tasks, worker, timing and reported errors                                       |
| Bitbucket Cloud | Build number, trigger, selector, commit message and completion time      | Pipeline steps shown as jobs, with timing and reported errors; no nested steps or runner metadata |

Availability also depends on the server version and returned fields. GitHub normally does not
provide a run completion timestamp, so its overall duration may be absent even when individual job
and step durations are available. Dovo does not substitute the last-update time for completion.

Step status and error summaries help identify where a run failed. Full logs stay on the provider;
use the run/job log links for complete output. Dispatch takes a branch/ref and optional JSON string
inputs. Workflows must support manual dispatch. Pipeline configuration editing, secrets management,
classic Azure release pipelines and live log streaming stay on the provider. Dovo never silently
emulates an unsupported action. Run/cancel/retry controls require an explicit submission and are not
retried automatically after a lost response. Run actions also check the current provider state:
active runs can be cancelled, finished runs can be rerun where supported, and unknown or
already-cancelling states cannot submit those actions.

Issue/run pages and details have a bounded runtime cache with stale fallback. Account and source
identity separate cache entries; successful writes invalidate the source cache. Pagination controls
are explicit. If an uncertain write fails, refresh before submitting again to avoid duplicates.

Provider and CLI contract fixtures cover source identity, writes and task creation. Live account
permissions and enterprise-specific policies still require validation against your own hosts.
