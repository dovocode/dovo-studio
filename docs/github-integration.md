# GitHub pull requests

Dovo performs GitHub operations on the selected runtime host against GitHub's API, using a token
that GitHub CLI (`gh`) mints for the host and account in use. The CLI itself still resolves the
checkout's repository, reads check rollups, reports login status and creates repositories. The
phone, desktop renderer and web client never need a GitHub token. Each registered project can use
its checkout's GitHub remote or an explicitly saved GitHub connection and `owner/repository`
binding.

## Connect a host

In Studio’s **Settings → Source control**, each computer shows its automatic GitHub CLI connection
as well as saved connections. The automatic section lists Git projects without an explicit forge
binding; folders and scratch projects are excluded. Saved GitHub connections list their explicitly
linked projects. Automatic detection does not create a saved connection or change GitHub CLI’s
active account.

Opening the page verifies the account in the runtime’s default context, reusing the existing
credential-keyed account verification cache. **Test connection** forces fresh account verification.
**Test project connection** also resolves that checkout’s effective account and checks repository
and Actions read access. Project checks run only when requested, so opening settings does not fetch
every project’s repository. Checkout-specific CLI configuration can select a different account from
the runtime default. Successful checks show the login, host, repository when applicable and check
time; a later failed check retains the last successful check time while the view remains open.

Authentication, permissions/organization SSO, repository discovery, network and rate-limit failures
have recovery guidance. Account verification alone does not establish repository access, and a
readable repository does not establish write permission or satisfaction of branch rules. Checks use
credentials on their owning runtime and never switch a global login or perform provider writes.

Project connection tests also request one Actions run using the same captured credential. Repository
access and Actions read access are reported separately; successful read access does not promise
rerun/cancel permissions. Automatic pipeline list/detail reads and thread-owned polling preserve the
GitHub quota reserve for interactive use. Explicit UI refresh and initial watch registration remain
interactive. Watch status retains `lastSuccessAt` across failures separately from the last check
time; desktop and mobile waiting panels expose the last successful pipeline poll. Existing persisted
watches without this field show no recorded success until a poll succeeds.

Install Git and GitHub CLI on the runtime machine, then authenticate as the account you want Dovo to
use:

```sh
gh auth login --hostname github.com
gh auth status --hostname github.com
```

For GitHub Enterprise Server, use its hostname in both commands and the saved connection. Dovo
passes the host and repository explicitly so a parent shell's `GH_REPO` or `GH_HOST` cannot redirect
a project operation. A saved connection can select a named `gh` account, a custom wrapper's
non-secret environment selector, or a token from the runtime environment. Each project's binding
controls its GitHub operations; selecting it never switches the global CLI login.

The CLI normally uses the system credential store. On machines without a working credential store,
GitHub CLI can fall back to its own plaintext configuration; inspect `gh auth status` and protect
the runtime user's home directory. Headless deployments can supply the CLI's documented
`GH_TOKEN`/`GITHUB_TOKEN` or enterprise equivalents through their service environment. Do not put
tokens into a repository URL or workspace configuration.

Tokens follow the CLI's own precedence: `GH_TOKEN`/`GITHUB_TOKEN` for github.com and
`GH_ENTERPRISE_TOKEN`/`GITHUB_ENTERPRISE_TOKEN` for other hosts win; otherwise Dovo runs
`gh auth token --hostname HOST` in the project's checkout, so per-directory CLI configuration still
selects the account, and `--user LOGIN` for a saved connection's named account. A minted token is
reused for five minutes and dropped when GitHub rejects it, so a new login applies on the next
request. Conditional requests reuse responses that GitHub reports unchanged, which do not count
against the quota.

Dovo namespaces PR caches by repository, host, active account and an opaque fingerprint of relevant
token environment variables. Successful account checks share a runtime-private, credential-keyed
cache for up to ten minutes, including concurrent identity discovery and reads of other
repositories. Every request still captures its credential and validates the project/connection
binding; changed credentials or connection revisions cannot reuse another account's verification.
Explicit refresh rechecks the account immediately; use it after `gh auth switch`. Authentication
rejection invalidates all contexts sharing that verification, and failed account checks are never
cached.

GitHub response headers update separate REST (core) and GraphQL budgets for each host and actual
credential. CLI repository/PR reads share the GraphQL budget with API calls. An exhausted GraphQL
budget does not pause REST pipeline requests; secondary limits still pause both. Dovo honors the
response's reset time or Retry-After, reads only the failed resource's reset from `/rate_limit` when
neither is available, and uses a one-minute pause if GitHub cannot report a reset. HTTP 200 GraphQL
rate-limit errors are handled too. Background refreshes pause below ten percent (at least 50
requests/points), keeping capacity for interactive reads and actions. Cached data stays available.

Checkout repository discovery shares concurrent reads and reuses successful metadata for ten
minutes. Changes to Git configuration, branch, credential, CLI environment or executable invalidate
it. Unchanged metadata remains usable during a rate-limit pause. Account verification and binding
checks still apply on every source-context read. Refreshing pipeline data reuses this metadata
instead of rediscovering the same repository through GraphQL.

Completed GitHub API command activity includes the endpoint, method, foreground/background flag and
each response's quota resource, remaining balance, reset, cumulative usage and conditional-cache hit
when GitHub reports them. Status-summary GraphQL queries also request their cost. These extra
diagnostics contain no tokens, request bodies or query variables; they identify which operations
consume quota without issuing additional API requests.

## Loading and caching PR details

Overview loads the PR header and description first. Status summaries and stack discovery load
independently. Files load when Changes opens, detailed checks and annotations when Checks opens, and
discussion when its activity, review or code-comment views need it. A slow or unavailable section
has its own loading state, warning and refresh control; it does not block the description or discard
other loaded sections.

The runtime stores each section separately in SQLite and shares concurrent requests for the same
section and verified account. Overview, status, discussion, checks and stack caches are fresh for
one minute; files for five minutes. Expired entries appear immediately while refreshing in the
background. Explicit refresh waits for a fresh read. Failed refreshes retain cached content with a
visible warning; an explicit retry bypasses the normal failure backoff. Writes invalidate the PR's
sections and lists across remembered checkout/account aliases, including after a restart.

Clients also retain sections for offline use. Files, comments and checks are combined only when
their PR URL, destination, head and base commits match Overview. A section that discovers a new
revision refreshes Overview; patches are withheld when a push happens during file pagination. Each
runtime still verifies the selected reader before serving its cache. Routed reads retain the
original runtime's destination, and writes remain on that original runtime.

The detail endpoint accepts an optional `section` and expected `revision` (`headSha:baseSha`).
Callers without a section retain the existing complete-detail response. Other forge providers
currently use their complete-detail adapter for section reads; the reduced GitHub API work described
above applies to GitHub.

## Projects on multiple computers

If the original runtime goes offline, PR lists and open PR details can continue reading through
another connected runtime with the same registered remote repository and verified GitHub account.
Project filters still include matching checkouts on other computers. An unknown or different account
cannot take over automatically; saved content remains visible when no verified reader is available.
Desktop and web retain the last verified source identity in their device cache so this handoff can
also work after reopening while the original runtime is offline.

Reading through another computer does not move comments, edits, merges, task creation or drafts to
it. Those actions retain the original runtime and destination and remain unavailable while that
runtime is offline. GitHub credentials stay on each runtime.

Each routed read, including later pages, checks the reader's captured credential and verified
account and destination; an unchanged credential can reuse the account verification described above.
If a saved source is rebound to another repository without changing its source scope, automatic
recovery stops rather than relabeling that repository's data as the original project. Refresh the
project's binding or explicitly choose its source to accept the new binding.

The PR clients and desktop issue/pipeline views read each remote repository through one connected
computer, including when several checkouts or worktrees point at it. When sources advertise
persistent runtime IDs, clients use the same deterministic preference per remote, independent of
their active computer, address or discovery order. Replicas must match the retained verified forge
account. The same preference is used again after the preferred computer recovers; while it is
unavailable, a verified same-account alternate serves reads. Older runtimes retain the previous
client-local routing. A remote that moves keeps its last loaded rows until the new reader answers.
The remote host is part of the identity, so forks and repositories on different hosts remain
separate.

This is shared placement, not a distributed lease: clients with different reachable server sets can
choose different readers. Thread-owned watches also remain on their owning runtime. Dovo does not
require a coordination service, move credentials between computers, or move writes to a read
replica.

Choose a specific project in the PR filter to use that checkout and its configured account. PR rows
keep that source's personal relationship flags; flags from different accounts are never combined.
Credentials and PR caches remain isolated by account on each runtime.

The PR category bar stays visible. **Filters** expands search, repository, state, sorting, draft and
attention controls; its badge counts active non-default controls while collapsed. Author profile
pictures appear beside author names in the list and details, with initials when an image is missing
or fails to load. Avatars use the forge-provided URL without extra API reads.

GitHub PR overviews use one basic list request per project/page, including author avatar URLs. They
use GitHub's native stack ID, number, position, size and base directly from that response. Parent
links are shown only when those members are present on the page. Branch inference remains available
for non-native stacks and older GitHub servers. Checks and review decisions load in PR details;
native stack details use one targeted stack endpoint instead of scanning PR list pages. Author,
assignment and direct review-request filters use basic response fields and the verified login. Team
review requests and participation that cannot be established from that response remain unknown.

Desktop and mobile automatically refresh only page one; **Load more** fetches subsequent pages on
demand. The runtime list cache returns saved data immediately and refreshes expired entries on
request. There is no independent background list timer: closing the view or moving its reader stops
that client's listing demand. Each runtime still watches its own tasks' linked PRs for status
changes and automatic settlement; those watches share local caches and count as background work for
the quota reserve above.

## Permissions

The runtime account needs access to the repository. Fine-grained token permissions depend on the
action:

| Workflow                                            | Repository permission                         |
| --------------------------------------------------- | --------------------------------------------- |
| Read PRs, reviews and comments                      | Pull requests: read                           |
| Create/edit PRs, comment, review, request reviewers | Pull requests: write                          |
| Merge PRs                                           | Contents: write, plus repository branch rules |
| Read check output and annotations                   | Checks: read                                  |
| Open private GitHub Actions job logs                | Actions: read                                 |

Organization SSO, repository roles and branch rules still apply. A supported action is not a grant
of permission. GitHub decides whether an account may perform it, and failures remain visible in the
form. Thread resolution also checks GitHub's current viewer permission before submission.

## Review and author workflows

- Create a PR from explicit existing remote head/base branches, optionally as a draft. Creation does
  not push commits or create forks automatically.
- Edit the PR title, description and base; close or reopen it.
- Post a discussion comment, submit approval, request changes, or submit a review comment. Reviews
  are attached to the head commit being displayed. Comments and change requests require a body; an
  approval may be empty.
- Add inline comments on selected old/new lines or ranges. Replies target the original comment in
  the thread, including when replying to an existing reply.
- Resolve or reopen review threads where GitHub permits it. Outdated and resolved state are kept
  separate from review approval.
- Request, re-request or remove review requests for users and team slugs. Other reviewers remain
  unchanged.
- Inspect check summaries, details and file/line annotations. A failed annotation request leaves the
  check's status and available output visible. Full job logs remain on the check's external page;
  Dovo does not download every log while opening a PR.
- Merge using an enabled repository method and the displayed head SHA. The provider must confirm the
  merge; a pending check, branch restriction or changed head is not reported as success.

Every mutating action checks the current head against the displayed revision. A changed head asks
you to refresh rather than applying an action to new code silently. Merge additionally sends the
expected SHA in the GitHub request. If a connection fails after submission, refresh and inspect the
PR before retrying: Dovo does not automatically replay external writes.

## Current limits

Review submission is immediate; collecting several comments into a server-side pending review,
editing existing comment bodies and dismissing reviews are not exposed by the current action
contract. Merge queue and auto-merge management remain on GitHub. “No merge conflicts” describes Git
compatibility, not satisfaction of branch protection or review rules.

Team review requests are not treated as a definite negative for the signed-in user when team
membership is unavailable. Direct user requests drive personalized prioritization; Dovo does not
infer membership from a team name. Large PRs and insufficient scopes can produce partial results;
the missing sections are reported and previously cached sections remain available.

## References

- [GitHub CLI authentication](https://cli.github.com/manual/gh_auth_login)
- [Pull request reviews](https://docs.github.com/en/rest/pulls/reviews)
- [Review comments and replies](https://docs.github.com/en/rest/pulls/comments)
- [Review requests](https://docs.github.com/en/rest/pulls/review-requests)
- [GraphQL review threads](https://docs.github.com/en/graphql/reference/pulls)
- [Pull requests and merging](https://docs.github.com/en/rest/pulls/pulls)
- [Check runs and annotations](https://docs.github.com/en/rest/checks/runs)
